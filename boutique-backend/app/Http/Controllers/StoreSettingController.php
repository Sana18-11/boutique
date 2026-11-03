<?php

namespace App\Http\Controllers;

use App\Models\StoreSetting;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StoreSettingController extends Controller
{
    public function show(): JsonResponse
    {
        try {
            return response()->json(StoreSetting::current());
        } catch (QueryException $exception) {
            report($exception);

            return response()->json(['message' => 'Unable to load store settings.'], 500);
        }
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_name' => ['nullable', 'string', 'max:255'],
            'store_email' => ['nullable', 'email', 'max:255'],
            'store_phone' => ['nullable', 'string', 'max:50'],
            'store_address' => ['nullable', 'string', 'max:5000'],
            'shipping_fee' => ['nullable', 'numeric', 'min:0'],
            'free_shipping_threshold' => ['nullable', 'numeric', 'min:0'],
            'return_policy' => ['nullable', 'string', 'max:50000'],
            'shipping_policy' => ['nullable', 'string', 'max:50000'],
            'privacy_policy' => ['nullable', 'string', 'max:50000'],
            'terms_policy' => ['nullable', 'string', 'max:50000'],
        ]);

        try {
            $settings = StoreSetting::current();
            $settings->fill($validated)->save();

            return response()->json($settings->fresh());
        } catch (QueryException $exception) {
            report($exception);

            return response()->json(['message' => 'Unable to save store settings.'], 500);
        }
    }
}