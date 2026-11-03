<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomerOrderTrackingTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_order_creation_and_public_order_number_lookup_are_denied(): void
    {
        $this->postJson('/api/orders', [])->assertUnauthorized();
        $this->getJson('/api/orders/ORD-PRIVATE-ORDER')->assertStatus(405);
        $this->getJson('/api/customer/orders/ORD-PRIVATE-ORDER')->assertUnauthorized();
    }

    public function test_customer_order_uses_database_prices_and_belongs_to_authenticated_customer(): void
    {
        $customer = User::factory()->create();
        $otherCustomer = User::factory()->create();
        $product = $this->createProduct();
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $response = $this->withToken($token)->postJson('/api/orders', [
            'user_id' => $otherCustomer->id,
            'order_number' => 'ORD-CLIENT-CHOSEN',
            'customer_name' => 'Delivery Name',
            'customer_phone' => '9876543210',
            'customer_address' => '1 Store Street, Chennai',
            'total_amount' => 1,
            'payment_status' => 'Paid',
            'items' => [[
                'product_id' => $product->id,
                'product_name' => 'Tampered product name',
                'quantity' => 2,
                'price' => 0,
            ]],
        ]);

        $response->assertCreated()
            ->assertJsonPath('user_id', $customer->id)
            ->assertJsonPath('customer_address', '1 Store Street, Chennai')
            ->assertJsonPath('total_amount', '450.00')
            ->assertJsonPath('status', 'Pending')
            ->assertJsonPath('payment_status', 'Pending')
            ->assertJsonPath('items.0.product_name', $product->name)
            ->assertJsonPath('items.0.price', '100.00')
            ->assertJsonPath('status_history.0.status', 'Pending');

        $order = Order::query()->where('user_id', $customer->id)->firstOrFail();
        $this->assertNotSame('ORD-CLIENT-CHOSEN', $order->order_number);
        $this->assertDatabaseHas('order_status_histories', [
            'order_id' => $order->id,
            'changed_by' => $customer->id,
            'status' => 'Pending',
        ]);
    }

    public function test_customer_can_only_list_and_track_their_own_orders(): void
    {
        $customer = User::factory()->create();
        $otherCustomer = User::factory()->create();
        $order = $this->createOrder($customer, 'ORD-OWN-ORDER');
        $otherOrder = $this->createOrder($otherCustomer, 'ORD-OTHER-ORDER');
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $this->withToken($token)->getJson('/api/customer/orders')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.order_number', $order->order_number);

        $this->withToken($token)->getJson('/api/customer/orders/'.$order->order_number)
            ->assertOk()
            ->assertJsonPath('user_id', $customer->id)
            ->assertJsonPath('status_history.0.status', 'Pending');

        $this->withToken($token)->getJson('/api/customer/orders/'.$otherOrder->order_number)
            ->assertNotFound();
    }

    public function test_admin_status_changes_are_validated_and_historied_without_marking_payment_paid(): void
    {
        $admin = User::factory()->create(['is_admin' => true]);
        $customer = User::factory()->create();
        $order = $this->createOrder($customer, 'ORD-ADMIN-UPDATE');
        $token = $admin->createToken('admin-orders', ['admin'])->plainTextToken;

        $this->withToken($token)->putJson('/api/orders/'.$order->id, [
            'status' => 'Shipped',
            'note' => 'Handed to the courier.',
            'payment_status' => 'Paid',
        ])->assertOk()
            ->assertJsonPath('status', 'Shipped')
            ->assertJsonPath('payment_status', 'Pending')
            ->assertJsonPath('status_history.0.status', 'Shipped')
            ->assertJsonPath('status_history.0.note', 'Handed to the courier.')
            ->assertJsonPath('status_history.0.changed_by', $admin->id);

        $this->assertDatabaseCount('order_status_histories', 2);

        $this->withToken($token)->putJson('/api/orders/'.$order->id, [
            'status' => 'Payment Confirmed',
        ])->assertUnprocessable();
    }

    private function createProduct(): Product
    {
        return Product::query()->create([
            'name' => 'Test Silk Saree',
            'price' => 100,
            'category' => 'Silk',
            'stock' => 5,
            'is_active' => true,
            'in_stock' => true,
        ]);
    }

    private function createOrder(User $customer, string $orderNumber): Order
    {
        $order = Order::query()->create([
            'user_id' => $customer->id,
            'order_number' => $orderNumber,
            'customer_name' => $customer->name,
            'customer_phone' => '9876543210',
            'customer_address' => 'Customer address',
            'total_amount' => 350,
            'status' => 'Pending',
            'payment_status' => 'Pending',
        ]);

        $order->statusHistory()->create([
            'status' => 'Pending',
            'note' => 'Order placed.',
        ]);

        return $order;
    }
}