<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminDashboardController extends Controller
{
    /**
     * Get real-time stats for the admin dashboard.
     */
    public function stats(Request $request): JsonResponse
    {
        $now = Carbon::now();
        $startOfMonth = $now->copy()->startOfMonth();
        $startOfWeek = $now->copy()->startOfWeek();
        $lastMonthStart = $now->copy()->subMonth()->startOfMonth();
        $lastMonthEnd = $now->copy()->subMonth()->endOfMonth();

        // 1. Total Sarees (Products)
        $totalSarees = Product::query()->count();
        $sareesThisMonth = Product::query()->where('created_at', '>=', $startOfMonth)->count();

        // 2. Total Orders
        $totalOrders = Order::query()->count();
        $ordersThisWeek = Order::query()->where('created_at', '>=', $startOfWeek)->count();

        // 3. Total Sales
        $totalSales = (float) Order::query()
            ->where('status', '!=', 'Cancelled')
            ->sum('total_amount');

        $salesThisMonth = (float) Order::query()
            ->where('status', '!=', 'Cancelled')
            ->where('created_at', '>=', $startOfMonth)
            ->sum('total_amount');

        $salesLastMonth = (float) Order::query()
            ->where('status', '!=', 'Cancelled')
            ->whereBetween('created_at', [$lastMonthStart, $lastMonthEnd])
            ->sum('total_amount');

        if ($salesLastMonth > 0) {
            $growth = round((($salesThisMonth - $salesLastMonth) / $salesLastMonth) * 100);
            $salesChange = ($growth >= 0 ? "+{$growth}%" : "{$growth}%") . ' this month';
        } else {
            $salesChange = '+' . number_format($salesThisMonth) . ' this month';
        }

        // 4. Pending Orders
        $pendingOrders = Order::query()->where('status', 'Pending')->count();
        $urgentPendingOrders = Order::query()
            ->where('status', 'Pending')
            ->where('created_at', '<=', $now->copy()->subHours(24))
            ->count();

        // 5. Low Stock
        $lowStock = Product::query()->where('stock', '<=', 5)->count();
        $outOfStock = Product::query()->where('stock', '<=', 0)->count();

        // 6. Customers
        $registeredCustomers = User::query()->where('is_admin', false)->count();
        $distinctOrderPhones = Order::query()
            ->whereNotNull('customer_phone')
            ->where('customer_phone', '<>', '')
            ->distinct('customer_phone')
            ->count('customer_phone');
        $totalCustomers = max($registeredCustomers, $distinctOrderPhones);

        $newCustomersThisMonth = User::query()
            ->where('is_admin', false)
            ->where('created_at', '>=', $startOfMonth)
            ->count();

        return response()->json([
            'total_sarees' => [
                'count' => $totalSarees,
                'change' => "+{$sareesThisMonth} this month",
            ],
            'total_orders' => [
                'count' => $totalOrders,
                'change' => "+{$ordersThisWeek} this week",
            ],
            'total_sales' => [
                'amount' => $totalSales,
                'formatted' => $this->formatCurrency($totalSales),
                'change' => $salesChange,
            ],
            'pending_orders' => [
                'count' => $pendingOrders,
                'urgent' => $urgentPendingOrders,
                'change' => $urgentPendingOrders > 0
                    ? "{$urgentPendingOrders} urgent"
                    : ($pendingOrders > 0 ? "{$pendingOrders} pending" : "All fulfilled"),
            ],
            'low_stock' => [
                'count' => $lowStock,
                'out_of_stock' => $outOfStock,
                'change' => $outOfStock > 0
                    ? "{$outOfStock} out of stock"
                    : ($lowStock > 0 ? 'Action needed' : 'Stock healthy'),
            ],
            'customers' => [
                'count' => $totalCustomers,
                'change' => "+{$newCustomersThisMonth} new",
            ],
        ]);
    }

    /**
     * Format currency in Indian numbering system (Lakhs / Thousands).
     */
    protected function formatCurrency(float $amount): string
    {
        if ($amount >= 100000) {
            $lakhs = round($amount / 100000, 1);
            return '₹' . $lakhs . 'L';
        }

        return '₹' . number_format($amount, 0, '.', ',');
    }
}
