<?php

namespace App\Http\Controllers;

use App\Models\Wishlist;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WishlistController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $sessionId = $request->header('X-Session-ID');

        if (! is_string($sessionId) || $sessionId === '') {
            return response()->json([]);
        }

        return response()->json(
            Wishlist::with('product')
                ->where('session_id', $sessionId)
                ->whereNull('user_id')
                ->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_id' => 'required|exists:products,id',
        ]);

        $sessionId = $request->header('X-Session-ID');
        if (! is_string($sessionId) || $sessionId === '') {
            return response()->json(['message' => 'A wishlist session is required.'], 422);
        }

        $wishlist = Wishlist::firstOrCreate([
            'product_id' => $validated['product_id'],
            'session_id' => $sessionId,
        ]);

        return response()->json($wishlist->load('product'), $wishlist->wasRecentlyCreated ? 201 : 200);
    }

    public function destroy(Request $request, int $productId): JsonResponse
    {
        $sessionId = $request->header('X-Session-ID');

        if (is_string($sessionId) && $sessionId !== '') {
            Wishlist::where('product_id', $productId)
                ->where('session_id', $sessionId)
                ->whereNull('user_id')
                ->delete();
        }

        return response()->json(['message' => 'Removed from wishlist']);
    }

    public function customerIndex(Request $request): JsonResponse
    {
        $user = $request->user();
        $sessionId = $request->header('X-Session-ID');

        if (is_string($sessionId) && $sessionId !== '') {
            DB::transaction(function () use ($user, $sessionId): void {
                $guestItems = Wishlist::query()
                    ->where('session_id', $sessionId)
                    ->whereNull('user_id')
                    ->get();

                foreach ($guestItems as $guestItem) {
                    Wishlist::firstOrCreate([
                        'user_id' => $user->id,
                        'product_id' => $guestItem->product_id,
                    ]);
                    $guestItem->delete();
                }
            });
        }

        return response()->json(
            Wishlist::with('product')
                ->where('user_id', $user->id)
                ->get()
        );
    }

    public function customerStore(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_id' => ['required', 'integer', 'exists:products,id'],
        ]);

        $wishlist = Wishlist::firstOrCreate([
            'user_id' => $request->user()->id,
            'product_id' => $validated['product_id'],
        ]);

        return response()->json($wishlist->load('product'), $wishlist->wasRecentlyCreated ? 201 : 200);
    }

    public function customerDestroy(Request $request, int $productId): JsonResponse
    {
        Wishlist::query()
            ->where('user_id', $request->user()->id)
            ->where('product_id', $productId)
            ->delete();

        return response()->json(['message' => 'Removed from wishlist']);
    }
}
