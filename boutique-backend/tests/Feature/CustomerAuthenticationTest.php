<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class CustomerAuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_sign_in_and_access_only_customer_routes(): void
    {
        $this->getJson('/api/customer/orders')->assertUnauthorized();

        $customer = User::factory()->create([
            'password' => Hash::make('secure-password'),
        ]);

        $response = $this->postJson('/api/customer/login', [
            'email' => $customer->email,
            'password' => 'secure-password',
        ]);

        $response->assertOk()
            ->assertJsonPath('user.id', $customer->id)
            ->assertJsonMissingPath('user.password');

        $token = $response->json('token');

        $this->withToken($token)->getJson('/api/customer/user')->assertOk();
        $this->withToken($token)->getJson('/api/orders')->assertForbidden();
        $this->withToken($token)->getJson('/api/customers')->assertForbidden();
        $this->withToken($token)->getJson('/api/admin/settings')->assertForbidden();
    }

    public function test_admin_accounts_cannot_sign_in_through_customer_authentication(): void
    {
        $admin = User::factory()->create([
            'email' => 'admin@example.com',
            'password' => Hash::make('secure-password'),
            'is_admin' => true,
        ]);

        $this->postJson('/api/customer/login', [
            'email' => $admin->email,
            'password' => 'secure-password',
        ])->assertUnprocessable();

        $this->getJson('/api/customer/user')->assertUnauthorized();

        $adminLogin = $this->postJson('/api/admin/login', [
            'email' => $admin->email,
            'password' => 'secure-password',
        ])->assertOk();

        $this->withToken($adminLogin->json('token'))
            ->postJson('/api/admin/logout')
            ->assertOk();
    }

    public function test_customer_logout_revokes_the_current_token(): void
    {
        $customer = User::factory()->create([
            'password' => Hash::make('secure-password'),
        ]);
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $this->withToken($token)->postJson('/api/customer/logout')->assertOk();
        $this->withToken($token)->getJson('/api/customer/user')->assertUnauthorized();
    }

    public function test_customer_order_history_contains_only_their_orders(): void
    {
        $customer = User::factory()->create();
        $otherCustomer = User::factory()->create();
        $ownedOrder = Order::query()->create([
            'user_id' => $customer->id,
            'order_number' => 'ORD-CUSTOMER-1',
            'customer_name' => $customer->name,
            'customer_phone' => '9876543210',
            'customer_address' => 'Customer address',
            'total_amount' => 100,
        ]);
        Order::query()->create([
            'user_id' => $otherCustomer->id,
            'order_number' => 'ORD-CUSTOMER-2',
            'customer_name' => $otherCustomer->name,
            'customer_phone' => '9876543211',
            'customer_address' => 'Other customer address',
            'total_amount' => 200,
        ]);
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $this->withToken($token)->getJson('/api/customer/orders')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $ownedOrder->id);
    }

    public function test_customer_can_update_only_their_own_permitted_profile_fields(): void
    {
        $customer = User::factory()->create();
        $otherCustomer = User::factory()->create();
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $this->withToken($token)->putJson('/api/customer/user', [
            'name' => 'Updated Customer',
            'email' => 'updated@example.com',
            'is_admin' => true,
            'password' => 'attempted-password-change',
        ])->assertOk()
            ->assertJsonPath('id', $customer->id)
            ->assertJsonPath('name', 'Updated Customer')
            ->assertJsonPath('email', 'updated@example.com')
            ->assertJsonMissingPath('is_admin')
            ->assertJsonMissingPath('password');

        $this->assertDatabaseHas('users', [
            'id' => $customer->id,
            'name' => 'Updated Customer',
            'email' => 'updated@example.com',
            'is_admin' => false,
        ]);
        $this->assertDatabaseHas('users', [
            'id' => $otherCustomer->id,
            'name' => $otherCustomer->name,
            'email' => $otherCustomer->email,
        ]);
    }
}