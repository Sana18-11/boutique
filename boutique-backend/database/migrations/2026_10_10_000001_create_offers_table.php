<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('offers', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->string('type');
            $table->string('value');
            $table->text('description');
            $table->string('status');
            $table->timestamps();
        });

        $now = now();
        $offers = [
            [
                'title' => 'Wedding Season Special',
                'type' => 'Discount',
                'value' => '10% OFF',
                'description' => 'Apply on all soft silk sarees above ₹15,000.',
                'status' => 'Active',
            ],
            [
                'title' => 'First Order Welcome',
                'type' => 'Coupon',
                'value' => 'DGWELCOME',
                'description' => 'Flat ₹750 off on first purchase above ₹5,000.',
                'status' => 'Active',
            ],
            [
                'title' => 'Festive Glow Banner',
                'type' => 'Banner',
                'value' => 'Featured',
                'description' => 'Hero banner for Navratri and Diwali festive edit.',
                'status' => 'Scheduled',
            ],
            [
                'title' => 'Weekend Saree Drop',
                'type' => 'Promotion',
                'value' => 'Free Shipping',
                'description' => 'Free pan-India shipping on orders over ₹4,999.',
                'status' => 'Paused',
            ],
        ];

        foreach ($offers as $offer) {
            if (! DB::table('offers')->where('title', $offer['title'])->exists()) {
                DB::table('offers')->insert($offer + [
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('offers');
    }
};