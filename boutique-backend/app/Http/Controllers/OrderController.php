<?php

namespace App\Http\Controllers;

use App\Models\Address;
use App\Models\Order;
use App\Models\Product;
use App\Models\StoreSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class OrderController extends Controller
{
    // Get orders: all orders for admin, or scoped to customer for authenticated customers
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user && $user->is_admin && $user->tokenCan('admin')) {
            return response()->json(
                Order::with(['items.product', 'statusHistory'])
                    ->latest()
                    ->get()
            );
        }

        if ($user && ! $user->is_admin && $user->tokenCan('customer')) {
            return $this->customerIndex($request);
        }

        return response()->json(['message' => 'Unauthorized.'], 403);
    }

    public function customerIndex(Request $request): JsonResponse
    {
        return response()->json(
            Order::query()
                ->with(['items.product', 'statusHistory'])
                ->where('user_id', $request->user()->id)
                ->latest()
                ->get()
        );
    }

    public function customerShow(Request $request, string $orderNumber): JsonResponse
    {
        $order = Order::query()
            ->with(['items.product', 'statusHistory'])
            ->where('user_id', $request->user()->id)
            ->where('order_number', $orderNumber)
            ->firstOrFail();

        return response()->json($order);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'customer_name' => ['required', 'string', 'max:255'],
            'customer_phone' => ['required', 'string', 'max:20'],
            'customer_address' => ['required', 'string', 'max:5000'],
            'address_line' => ['nullable', 'string', 'max:500'],
            'city' => ['nullable', 'string', 'max:100'],
            'state' => ['nullable', 'string', 'max:100'],
            'pin_code' => ['nullable', 'string', 'max:20'],
            'landmark' => ['nullable', 'string', 'max:255'],
            'items' => ['required', 'array', 'min:1', 'max:50'],
            'items.*.product_id' => ['required', 'integer', 'distinct', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:100'],
        ]);

        $customer = $request->user();
        $order = DB::transaction(function () use ($validated, $customer): Order {
            $settings = StoreSetting::query()->find(1);
            $shippingFeeCents = (int) round((float) ($settings?->shipping_fee ?? 250) * 100);
            $freeShippingThresholdCents = (int) round((float) ($settings?->free_shipping_threshold ?? 10000) * 100);
            $subtotalCents = 0;
            $items = [];

            foreach ($validated['items'] as $index => $item) {
                $product = Product::query()
                    ->whereKey($item['product_id'])
                    ->lockForUpdate()
                    ->first();

                if (! $product || ! $product->is_active || ! $product->in_stock || $product->stock < $item['quantity']) {
                    throw ValidationException::withMessages([
                        "items.$index.quantity" => 'This product is unavailable in the requested quantity.',
                    ]);
                }

                $subtotalCents += (int) round((float) $product->price * 100) * $item['quantity'];
                $items[] = [
                    'product_id' => $product->id,
                    'product_name' => $product->name,
                    'quantity' => $item['quantity'],
                    'price' => $product->price,
                ];
            }

            $shippingCents = $subtotalCents > $freeShippingThresholdCents ? 0 : $shippingFeeCents;
            $order = Order::query()->create([
                'user_id' => $customer->id,
                'order_number' => 'ORD-'.Str::upper((string) Str::uuid()),
                'customer_name' => $validated['customer_name'],
                'customer_phone' => $validated['customer_phone'],
                'customer_address' => $validated['customer_address'],
                'total_amount' => number_format(($subtotalCents + $shippingCents) / 100, 2, '.', ''),
                'status' => 'Pending',
                'payment_status' => 'Pending',
                'expected_delivery_date' => now()->addDays(Order::DELIVERY_TIMELINE_DAYS)->toDateString(),
            ]);

            $order->items()->createMany($items);
            $order->statusHistory()->create([
                'changed_by' => $customer->id,
                'status' => 'Pending',
                'note' => 'Order placed.',
            ]);

            // Save address to customer's account if structured address fields are provided and not duplicate
            if ($customer && ! empty($validated['address_line']) && ! empty($validated['city']) && ! empty($validated['state']) && ! empty($validated['pin_code'])) {
                $addressLine = trim($validated['address_line']);
                $city = trim($validated['city']);
                $state = trim($validated['state']);
                $pinCode = trim($validated['pin_code']);
                $landmark = ! empty($validated['landmark']) ? trim($validated['landmark']) : null;
                $name = trim($validated['customer_name']);
                $phone = trim($validated['customer_phone']);

                $exists = Address::query()
                    ->where('user_id', $customer->id)
                    ->where('name', $name)
                    ->where('phone', $phone)
                    ->where('address_line', $addressLine)
                    ->where('city', $city)
                    ->where('state', $state)
                    ->where('pin_code', $pinCode)
                    ->where(function ($query) use ($landmark) {
                        if (empty($landmark)) {
                            $query->whereNull('landmark')->orWhere('landmark', '');
                        } else {
                            $query->where('landmark', $landmark);
                        }
                    })
                    ->exists();

                if (! $exists) {
                    $hasAddresses = Address::query()->where('user_id', $customer->id)->exists();
                    Address::query()->create([
                        'user_id' => $customer->id,
                        'name' => $name,
                        'phone' => $phone,
                        'address_line' => $addressLine,
                        'city' => $city,
                        'state' => $state,
                        'pin_code' => $pinCode,
                        'landmark' => $landmark,
                        'is_default' => ! $hasAddresses,
                    ]);
                }
            }

            return $order;
        });

        return response()->json($order->load(['items.product', 'statusHistory']), 201);
    }

    // Update order status/payment status
    public function update(Request $request, Order $order)
    {
        $validated = $request->validate([
            'status' => ['required', 'string', Rule::in(Order::STATUSES)],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        return DB::transaction(function () use ($request, $order, $validated): JsonResponse {
            if ($order->status !== $validated['status']) {
                $order->update(['status' => $validated['status']]);
                $order->statusHistory()->create([
                    'changed_by' => $request->user()->id,
                    'status' => $validated['status'],
                    'note' => $validated['note'] ?? null,
                ]);
            }

            return response()->json($order->load('statusHistory'));
        });
    }

    // Delete an order
    public function destroy(Order $order)
    {
        $order->delete();

        return response()->json([
            'message' => 'Order deleted successfully'
        ]);
    }
}
