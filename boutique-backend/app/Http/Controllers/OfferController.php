<?php

namespace App\Http\Controllers;

use App\Models\Offer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OfferController extends Controller
{
    private const TYPES = ['Discount', 'Coupon', 'Banner', 'Promotion'];

    private const STATUSES = ['Active', 'Scheduled', 'Paused'];

    public function index(): JsonResponse
    {
        return response()->json(Offer::query()->orderBy('id')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $offer = Offer::create($request->validate($this->rules()));

        return response()->json($offer, 201);
    }

    public function update(Request $request, Offer $offer): JsonResponse
    {
        $offer->update($request->validate($this->rules(partial: true)));

        return response()->json($offer->fresh());
    }

    public function destroy(Offer $offer): JsonResponse
    {
        $offer->delete();

        return response()->json(['message' => 'Offer deleted successfully']);
    }

    private function rules(bool $partial = false): array
    {
        $required = $partial ? 'sometimes|required' : 'required';

        return [
            'title' => [$required, 'string', 'max:255'],
            'type' => [$required, Rule::in(self::TYPES)],
            'value' => [$required, 'string', 'max:255'],
            'description' => [$required, 'string'],
            'status' => [$required, Rule::in(self::STATUSES)],
        ];
    }
}