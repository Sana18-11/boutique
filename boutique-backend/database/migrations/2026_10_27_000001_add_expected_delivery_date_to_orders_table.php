<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->date('expected_delivery_date')->nullable()->after('payment_status');
        });

        // Calculate and backfill expected delivery date for existing active orders (order date + 6 days timeline)
        $orders = DB::table('orders')
            ->whereNull('expected_delivery_date')
            ->whereNotNull('created_at')
            ->where('status', '!=', 'Cancelled')
            ->select('id', 'created_at')
            ->get();

        foreach ($orders as $order) {
            $expectedDate = Carbon::parse($order->created_at)->addDays(6)->toDateString();
            DB::table('orders')->where('id', $order->id)->update([
                'expected_delivery_date' => $expectedDate,
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('expected_delivery_date');
        });
    }
};
