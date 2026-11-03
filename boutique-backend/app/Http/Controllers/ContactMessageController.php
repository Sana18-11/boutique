<?php

namespace App\Http\Controllers;

use App\Models\ContactMessage;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContactMessageController extends Controller
{
    public function index(): JsonResponse
    {
        $messages = ContactMessage::query()
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (ContactMessage $message) => [
                'id' => $message->id,
                'name' => $message->name,
                'email' => $message->email,
                'mobile' => $message->mobile,
                'message' => $message->message,
                'is_read' => (bool) $message->is_read,
                'created_at' => $message->created_at?->toIso8601String(),
            ]);

        return response()->json($messages);
    }

    public function markAsRead(ContactMessage $message): JsonResponse
    {
        $message->update(['is_read' => true]);

        return response()->json([
            'id' => $message->id,
            'is_read' => true,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'mobile' => ['required', 'string', 'regex:/^\+?[1-9]\d{9,14}$/'],
            'message' => ['required', 'string', 'max:5000'],
        ]);

        try {
            ContactMessage::query()->create($validated);
        } catch (QueryException $exception) {
            report($exception);

            return response()->json([
                'message' => 'Unable to send your message right now. Please try again later.',
            ], 500);
        }

        return response()->json([
            'message' => 'Your message has been sent successfully.',
        ], 201);
    }
}
