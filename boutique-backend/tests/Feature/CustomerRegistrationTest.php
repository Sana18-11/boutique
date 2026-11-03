<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class CustomerRegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_register_with_a_hashed_password_and_cannot_become_an_admin(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Asha Customer',
            'email' => 'asha@example.com',
            'password' => 'secure-password',
            'password_confirmation' => 'secure-password',
            'is_admin' => true,
        ]);

        $response->assertCreated()
            ->assertJsonPath('user.name', 'Asha Customer')
            ->assertJsonPath('user.email', 'asha@example.com')
            ->assertJsonMissingPath('user.password');

        $user = User::query()->where('email', 'asha@example.com')->firstOrFail();
        $this->assertTrue(Hash::check('secure-password', $user->password));
        $this->assertFalse($user->is_admin);
    }

    public function test_registration_rejects_duplicate_emails_and_unconfirmed_passwords(): void
    {
        User::factory()->create(['email' => 'asha@example.com']);

        $this->postJson('/api/register', [
            'name' => 'Asha Customer',
            'email' => 'asha@example.com',
            'password' => 'secure-password',
            'password_confirmation' => 'different-password',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password']);
    }
}