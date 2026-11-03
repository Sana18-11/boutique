<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
       Schema::create('orders', function (Blueprint $table) {
    $table->id();

    $table->string('order_number')->unique();

    // Customer details
    $table->string('customer_name');
    $table->string('customer_phone');
    $table->text('customer_address');

    // Order amount
    $table->decimal('total_amount', 10, 2);

    // Order status
    $table->string('status')->default('Pending');

    // Payment status
    $table->string('payment_status')->default('Pending');

    $table->timestamps();
});
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
