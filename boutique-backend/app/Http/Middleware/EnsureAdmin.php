<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user?->is_admin || ! $user->tokenCan('admin')) {
            return response()->json(['message' => 'Administrator access required.'], 403);
        }

        return $next($request);
    }
}