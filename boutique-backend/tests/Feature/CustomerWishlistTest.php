<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\User;
use App\Models\Wishlist;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomerWishlistTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_wishlist_requires_authentication_and_is_scoped_to_the_owner(): void
    {
        $product = $this->createProduct('Wishlist item');
        $customer = User::factory()->create();
        $otherCustomer = User::factory()->create();
        Wishlist::query()->create(['user_id' => $customer->id, 'product_id' => $product->id]);
        Wishlist::query()->create(['user_id' => $otherCustomer->id, 'product_id' => $this->createProduct('Other item')->id]);

        $this->getJson('/api/customer/wishlist')->assertUnauthorized();
        $this->postJson('/api/customer/wishlist', ['product_id' => $product->id])->assertUnauthorized();
        $this->deleteJson('/api/customer/wishlist/'.$product->id)->assertUnauthorized();

        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;
        $this->withToken($token)->getJson('/api/customer/wishlist')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.product_id', $product->id);

        $otherItem = Wishlist::query()->where('user_id', $otherCustomer->id)->firstOrFail();
        $this->withToken($token)->deleteJson('/api/customer/wishlist/'.$otherItem->product_id)->assertOk();
        $this->assertDatabaseHas('wishlists', ['id' => $otherItem->id, 'user_id' => $otherCustomer->id]);
    }

    public function test_customer_can_add_remove_and_retain_wishlist_items(): void
    {
        $customer = User::factory()->create();
        $product = $this->createProduct('Customer item');
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $this->withToken($token)->postJson('/api/customer/wishlist', ['product_id' => $product->id])
            ->assertCreated()
            ->assertJsonPath('product_id', $product->id);
        $this->assertDatabaseHas('wishlists', ['user_id' => $customer->id, 'product_id' => $product->id]);

        $this->withToken($token)->deleteJson('/api/customer/wishlist/'.$product->id)->assertOk();
        $this->assertDatabaseMissing('wishlists', ['user_id' => $customer->id, 'product_id' => $product->id]);
    }

    public function test_authenticated_load_merges_this_session_wishlist_and_deduplicates_items(): void
    {
        $customer = User::factory()->create();
        $existingProduct = $this->createProduct('Already saved');
        $guestProduct = $this->createProduct('Guest saved');
        $sessionId = 'browser-session-123';
        Wishlist::query()->create(['user_id' => $customer->id, 'product_id' => $existingProduct->id]);
        Wishlist::query()->create(['session_id' => $sessionId, 'product_id' => $existingProduct->id]);
        Wishlist::query()->create(['session_id' => $sessionId, 'product_id' => $guestProduct->id]);
        $token = $customer->createToken('customer-session', ['customer'])->plainTextToken;

        $this->withToken($token)->withHeader('X-Session-ID', $sessionId)
            ->getJson('/api/customer/wishlist')
            ->assertOk()
            ->assertJsonCount(2);

        $this->assertDatabaseCount('wishlists', 2);
        $this->assertDatabaseHas('wishlists', ['user_id' => $customer->id, 'product_id' => $guestProduct->id]);

        $this->withToken($token)->getJson('/api/customer/wishlist')
            ->assertOk()
            ->assertJsonCount(2);
    }

    public function test_legacy_guest_wishlist_remains_session_scoped(): void
    {
        $product = $this->createProduct('Guest item');
        $this->withHeader('X-Session-ID', 'guest-session-a')
            ->postJson('/api/wishlist', ['product_id' => $product->id])
            ->assertCreated();

        $this->withHeader('X-Session-ID', 'guest-session-b')
            ->getJson('/api/wishlist')
            ->assertOk()
            ->assertJsonCount(0);

        $this->withHeader('X-Session-ID', 'guest-session-a')
            ->getJson('/api/wishlist')
            ->assertOk()
            ->assertJsonCount(1);
    }

    private function createProduct(string $name): Product
    {
        return Product::query()->create([
            'name' => $name,
            'price' => 100,
            'category' => 'Silk',
            'stock' => 5,
        ]);
    }
}