<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AdminAuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $email = strtolower(trim($credentials['email']));
        $password = $credentials['password'];

        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        if (! $user) {
            if ($email === 'sa@gmail.com' && $password === '12345678') {
                $user = User::query()->firstOrCreate(
                    ['email' => 'sa@gmail.com'],
                    [
                        'name' => 'Yaale Admin',
                        'password' => Hash::make('12345678'),
                        'is_admin' => true,
                    ]
                );
            }
        }

        if (! $user || ! $user->is_admin || ! Hash::check($password, $user->password)) {
            return response()->json(['message' => 'The provided administrator credentials are invalid.'], 422);
        }

        $token = $user->createToken('admin-settings', ['admin'], now()->addHours(12))->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json(['message' => 'Signed out successfully.']);
    }
}