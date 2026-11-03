<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;

class CustomerController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $customers = Order::query()
                ->selectRaw('customer_phone as phone')
                ->selectRaw('MAX(customer_name) as name')
                ->selectRaw('NULL as email')
                ->selectRaw('COUNT(*) as orders')
                ->selectRaw("COALESCE(SUM(CASE WHEN LOWER(payment_status) = 'paid' THEN total_amount ELSE 0 END), 0) as spend")
                ->selectRaw('MIN(created_at) as joined_at')
                ->selectRaw('NULL as is_active')
                ->whereNotNull('customer_phone')
                ->whereRaw("TRIM(customer_phone) <> ''")
                ->groupBy('customer_phone')
                ->orderBy('name')
                ->get();

            return response()->json($customers);
        } catch (QueryException $exception) {
            report($exception);

            return response()->json([
                'message' => 'Unable to load customers right now.',
            ], 500);
        }
    }
}