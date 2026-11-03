<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ContactMessageTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_customer_can_submit_a_contact_message(): void
    {
        $response = $this->postJson('/api/contact-messages', [
            'name' => 'Yaale Customer',
            'email' => 'customer@example.com',
            'mobile' => '+919876543210',
            'message' => 'Please share saree availability.',
        ]);

        $response
            ->assertCreated()
            ->assertJson(['message' => 'Your message has been sent successfully.']);

        $this->assertDatabaseHas('contact_messages', [
            'name' => 'Yaale Customer',
            'email' => 'customer@example.com',
            'mobile' => '+919876543210',
            'message' => 'Please share saree availability.',
        ]);
    }

    public function test_contact_message_fields_are_required_and_validated(): void
    {
        $response = $this->postJson('/api/contact-messages', [
            'name' => '',
            'email' => 'not-an-email',
            'mobile' => '12345',
            'message' => '',
        ]);

        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'email', 'mobile', 'message']);
    }

}
