<?php

namespace App\Http\Controllers;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CategoryController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Category::query()->withCount('products')->orderBy('name')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:categories,name'],
            'description' => ['required', 'string'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $category = Category::create($validated);

        return response()->json($category->loadCount('products'), 201);
    }

    public function update(Request $request, Category $category): JsonResponse
    {
        $validated = $request->validate([
            'name' => [
                'sometimes',
                'required',
                'string',
                'max:255',
                Rule::unique('categories', 'name')->ignore($category->id),
            ],
            'description' => ['sometimes', 'required', 'string'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $previousName = $category->name;

        DB::transaction(function () use ($category, $validated, $previousName): void {
            if (isset($validated['name']) && $validated['name'] !== $previousName) {
                Product::query()
                    ->where('category', $previousName)
                    ->update(['category' => $validated['name']]);
            }

            $category->update($validated);
        });

        return response()->json($category->fresh()->loadCount('products'));
    }

    public function destroy(Category $category): JsonResponse
    {
        if ($category->products()->exists()) {
            return response()->json([
                'message' => 'This category cannot be deleted while products are assigned to it.',
            ], 409);
        }

        $category->delete();

        return response()->json([
            'message' => 'Category deleted successfully',
        ]);
    }
}