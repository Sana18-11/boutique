<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_status_histories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status');
            $table->text('note')->nullable();
            $table->timestamps();
            $table->index(['order_id', 'created_at']);
        });

        DB::table('orders')->orderBy('id')->chunkById(500, function ($orders): void {
            foreach ($orders as $order) {
                DB::table('order_status_histories')->insert([
                    'order_id' => $order->id,
                    'changed_by' => null,
                    'status' => $order->status ?: 'Pending',
                    'note' => 'Status recorded during order history setup.',
                    'created_at' => $order->updated_at ?? now(),
                    'updated_at' => now(),
                ]);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_status_histories');
    }
};