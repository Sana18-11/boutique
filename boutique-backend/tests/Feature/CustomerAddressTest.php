<?php

namespace Tests\Feature;

use App\Models\Address;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomerAddressTest extends TestCase
{
    use RefreshDatabase;

    public function test_address_routes_require_customer_authentication_and_are_scoped_to_the_owner(): void
    {
        $customer = User::factory()->create(['is_admin' => false]);
        $otherCustomer = User::factory()->create(['is_admin' => false]);

        $customerAddress = Address::query()->create([
            'user_id' => $customer->id,
            'name' => 'Meera Raman',
            'phone' => '9876543210',
            'address_line' => '12 Temple Street',
            'city' => 'Chennai',
            'state' => 'Tamil Nadu',
            'pin_code' => '600004',
            'landmark' => 'Near Kapaleeshwarar Temple',
            'is_default' => true,
        ]);

        $otherAddress = Address::query()->create([
            'user_id' => $otherCustomer->id,
            'name' => 'Kavitha S',
            'phone' => '9123456780',
            'address_line' => '45 Beach Road',
            'city' => 'Chennai',
            'state' => 'Tamil Nadu',
            'pin_code' => '600041',
            'is_default' => true,
        ]);

        // Unauthenticated calls must fail
        $this->getJson('/api/customer/addresses')->assertUnauthorized();
        $this->postJson('/api/customer/addresses', [
            'name' => 'Test',
            'phone' => '9876543210',
            'address_line' => 'Line 1',
            'city' => 'Chennai',
            'state' => 'Tamil Nadu',
            'pin_code' => '600001',
        ])->assertUnauthorized();

        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        // Customer sees only their own addresses
        $response = $this->withToken($token)->getJson('/api/customer/addresses')
            ->assertOk()
            ->assertJsonCount(1);

        $this->assertEquals($customerAddress->id, $response->json('0.id'));

        // Customer cannot update or delete other customer's address
        $this->withToken($token)->putJson('/api/customer/addresses/'.$otherAddress->id, [
            'name' => 'Hacked',
            'phone' => '9876543210',
            'address_line' => 'Hacked',
            'city' => 'Chennai',
            'state' => 'Tamil Nadu',
            'pin_code' => '600001',
        ])->assertForbidden();

        $this->withToken($token)->deleteJson('/api/customer/addresses/'.$otherAddress->id)->assertForbidden();
        $this->withToken($token)->patchJson('/api/customer/addresses/'.$otherAddress->id.'/default')->assertForbidden();
    }

    public function test_customer_can_create_address_and_first_address_is_default(): void
    {
        $customer = User::factory()->create(['is_admin' => false]);
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $response = $this->withToken($token)->postJson('/api/customer/addresses', [
            'name' => 'Ananya Roy',
            'phone' => '9876543210',
            'address_line' => 'Flat 4B, Lotus Apartments',
            'city' => 'Bengaluru',
            'state' => 'Karnataka',
            'pin_code' => '560001',
            'landmark' => 'Opposite Metro Station',
        ])->assertCreated();

        $this->assertTrue($response->json('is_default'));
        $this->assertDatabaseHas('addresses', [
            'user_id' => $customer->id,
            'name' => 'Ananya Roy',
            'city' => 'Bengaluru',
            'is_default' => 1,
        ]);
    }

    public function test_duplicate_address_submission_does_not_create_duplicate_row(): void
    {
        $customer = User::factory()->create(['is_admin' => false]);
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $payload = [
            'name' => 'Ananya Roy',
            'phone' => '9876543210',
            'address_line' => 'Flat 4B, Lotus Apartments',
            'city' => 'Bengaluru',
            'state' => 'Karnataka',
            'pin_code' => '560001',
            'landmark' => 'Opposite Metro',
        ];

        $res1 = $this->withToken($token)->postJson('/api/customer/addresses', $payload)->assertCreated();
        $res2 = $this->withToken($token)->postJson('/api/customer/addresses', $payload)->assertOk();

        $this->assertEquals($res1->json('id'), $res2->json('id'));
        $this->assertDatabaseCount('addresses', 1);
    }

    public function test_customer_can_set_default_and_delete_address_with_promotion(): void
    {
        $customer = User::factory()->create(['is_admin' => false]);
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $addr1 = Address::query()->create([
            'user_id' => $customer->id,
            'name' => 'Address 1',
            'phone' => '9876543210',
            'address_line' => 'Line 1',
            'city' => 'Chennai',
            'state' => 'Tamil Nadu',
            'pin_code' => '600001',
            'is_default' => true,
        ]);

        $addr2 = Address::query()->create([
            'user_id' => $customer->id,
            'name' => 'Address 2',
            'phone' => '9876543210',
            'address_line' => 'Line 2',
            'city' => 'Chennai',
            'state' => 'Tamil Nadu',
            'pin_code' => '600002',
            'is_default' => false,
        ]);

        // Set addr2 as default
        $this->withToken($token)->patchJson('/api/customer/addresses/'.$addr2->id.'/default')
            ->assertOk()
            ->assertJsonPath('is_default', true);

        $this->assertFalse($addr1->fresh()->is_default);
        $this->assertTrue($addr2->fresh()->is_default);

        // Delete addr2 (default); addr1 should be promoted to default
        $this->withToken($token)->deleteJson('/api/customer/addresses/'.$addr2->id)
            ->assertOk();

        $this->assertDatabaseMissing('addresses', ['id' => $addr2->id]);
        $this->assertTrue($addr1->fresh()->is_default);
    }

    public function test_order_creation_auto_saves_shipping_address_for_customer(): void
    {
        $customer = User::factory()->create(['is_admin' => false]);
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;
        $product = Product::query()->create([
            'name' => 'Kanjivaram Silk Saree',
            'price' => 12500,
            'category' => 'Silk',
            'stock' => 10,
            'is_active' => true,
            'in_stock' => true,
        ]);

        $orderPayload = [
            'customer_name' => 'Radha Krishnan',
            'customer_phone' => '9876543210',
            'customer_address' => '10 Gandhi Road, Near Post Office, Coimbatore, Tamil Nadu - 641001',
            'address_line' => '10 Gandhi Road',
            'landmark' => 'Near Post Office',
            'city' => 'Coimbatore',
            'state' => 'Tamil Nadu',
            'pin_code' => '641001',
            'items' => [
                [
                    'product_id' => $product->id,
                    'quantity' => 1,
                ],
            ],
        ];

        $this->withToken($token)->postJson('/api/orders', $orderPayload)->assertCreated();

        $this->assertDatabaseHas('addresses', [
            'user_id' => $customer->id,
            'name' => 'Radha Krishnan',
            'city' => 'Coimbatore',
            'pin_code' => '641001',
            'is_default' => 1,
        ]);
    }
}
