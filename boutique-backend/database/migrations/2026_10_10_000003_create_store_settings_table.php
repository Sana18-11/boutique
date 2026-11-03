<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('store_settings', function (Blueprint $table) {
            $table->id();
            $table->string('store_name')->nullable();
            $table->string('store_email')->nullable();
            $table->string('store_phone', 50)->nullable();
            $table->text('store_address')->nullable();
            $table->decimal('shipping_fee', 10, 2)->nullable();
            $table->decimal('free_shipping_threshold', 10, 2)->nullable();
            $table->longText('return_policy')->nullable();
            $table->longText('shipping_policy')->nullable();
            $table->longText('privacy_policy')->nullable();
            $table->longText('terms_policy')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('store_settings');
    }
};