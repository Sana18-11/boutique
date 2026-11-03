<?php

namespace App\Http\Controllers;

use App\Models\Address;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AddressController extends Controller
{
    /**
     * Get all saved addresses for the authenticated customer.
     */
    public function index(Request $request): JsonResponse
    {
        $addresses = Address::query()
            ->where('user_id', $request->user()->id)
            ->orderByDesc('is_default')
            ->latest()
            ->get();

        return response()->json($addresses);
    }

    /**
     * Store a new saved address for the authenticated customer.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $this->validateAddress($request);
        $user = $request->user();

        // Check if user already has an identical address to prevent duplicates
        $existing = Address::query()
            ->where('user_id', $user->id)
            ->where('name', $validated['name'])
            ->where('phone', $validated['phone'])
            ->where('address_line', $validated['address_line'])
            ->where('city', $validated['city'])
            ->where('state', $validated['state'])
            ->where('pin_code', $validated['pin_code'])
            ->where(function ($query) use ($validated) {
                if (empty($validated['landmark'])) {
                    $query->whereNull('landmark')->orWhere('landmark', '');
                } else {
                    $query->where('landmark', $validated['landmark']);
                }
            })
            ->first();

        $wantsDefault = $request->boolean('is_default');
        $addressCount = Address::query()->where('user_id', $user->id)->count();

        return DB::transaction(function () use ($user, $validated, $existing, $wantsDefault, $addressCount): JsonResponse {
            if ($existing) {
                if ($wantsDefault && ! $existing->is_default) {
                    Address::query()
                        ->where('user_id', $user->id)
                        ->where('id', '!=', $existing->id)
                        ->update(['is_default' => false]);

                    $existing->update(['is_default' => true]);
                }

                return response()->json($existing->fresh(), 200);
            }

            $shouldBeDefault = $wantsDefault || $addressCount === 0;

            if ($shouldBeDefault && $addressCount > 0) {
                Address::query()
                    ->where('user_id', $user->id)
                    ->update(['is_default' => false]);
            }

            $address = Address::query()->create([
                'user_id' => $user->id,
                'name' => $validated['name'],
                'phone' => $validated['phone'],
                'address_line' => $validated['address_line'],
                'city' => $validated['city'],
                'state' => $validated['state'],
                'pin_code' => $validated['pin_code'],
                'landmark' => $validated['landmark'] ?? null,
                'is_default' => $shouldBeDefault,
            ]);

            return response()->json($address, 201);
        });
    }

    /**
     * Update an existing address belonging to the authenticated customer.
     */
    public function update(Request $request, Address $address): JsonResponse
    {
        $user = $request->user();

        if ($address->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized action.'], 403);
        }

        $validated = $this->validateAddress($request);
        $wantsDefault = $request->boolean('is_default');

        return DB::transaction(function () use ($user, $address, $validated, $wantsDefault): JsonResponse {
            if ($wantsDefault && ! $address->is_default) {
                Address::query()
                    ->where('user_id', $user->id)
                    ->where('id', '!=', $address->id)
                    ->update(['is_default' => false]);
            }

            $address->update([
                'name' => $validated['name'],
                'phone' => $validated['phone'],
                'address_line' => $validated['address_line'],
                'city' => $validated['city'],
                'state' => $validated['state'],
                'pin_code' => $validated['pin_code'],
                'landmark' => $validated['landmark'] ?? null,
                'is_default' => $wantsDefault ? true : $address->is_default,
            ]);

            return response()->json($address->fresh());
        });
    }

    /**
     * Delete an address belonging to the authenticated customer.
     */
    public function destroy(Request $request, Address $address): JsonResponse
    {
        $user = $request->user();

        if ($address->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized action.'], 403);
        }

        return DB::transaction(function () use ($user, $address): JsonResponse {
            $wasDefault = $address->is_default;
            $address->delete();

            // If the default address was deleted, promote the newest remaining address to default
            if ($wasDefault) {
                $nextDefault = Address::query()
                    ->where('user_id', $user->id)
                    ->latest()
                    ->first();

                if ($nextDefault) {
                    $nextDefault->update(['is_default' => true]);
                }
            }

            return response()->json(['message' => 'Address deleted successfully.']);
        });
    }

    /**
     * Set a specific address as default for the customer.
     */
    public function setDefault(Request $request, Address $address): JsonResponse
    {
        $user = $request->user();

        if ($address->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized action.'], 403);
        }

        return DB::transaction(function () use ($user, $address): JsonResponse {
            Address::query()
                ->where('user_id', $user->id)
                ->where('id', '!=', $address->id)
                ->update(['is_default' => false]);

            $address->update(['is_default' => true]);

            return response()->json($address->fresh());
        });
    }

    /**
     * Validate and sanitize address request input.
     *
     * @return array<string, mixed>
     */
    protected function validateAddress(Request $request): array
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'max:20'],
            'address_line' => ['required', 'string', 'max:500'],
            'city' => ['required', 'string', 'max:100'],
            'state' => ['required', 'string', 'max:100'],
            'pin_code' => ['required', 'string', 'max:20'],
            'landmark' => ['nullable', 'string', 'max:255'],
            'is_default' => ['nullable', 'boolean'],
        ]);

        return [
            'name' => trim($validated['name']),
            'phone' => trim($validated['phone']),
            'address_line' => trim($validated['address_line']),
            'city' => trim($validated['city']),
            'state' => trim($validated['state']),
            'pin_code' => trim($validated['pin_code']),
            'landmark' => isset($validated['landmark']) ? trim((string) $validated['landmark']) : null,
            'is_default' => $request->boolean('is_default'),
        ];
    }
}
