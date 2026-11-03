<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ProductController extends Controller
{
    public function index()
{
    return response()->json(
        Product::with('images')
            ->where('is_active', true)
            ->get()
    );
}

    public function store(Request $request)
{
    $validated = $request->validate([
        'name' => 'required|string|max:255',
        'description' => 'nullable|string',
        'original_price' => 'required|numeric|min:0',
        'discount' => 'nullable|numeric|min:0|max:100',
        'category' => 'required|string|max:255',
        'image' => 'nullable|image|max:5120',
        'badge' => 'nullable|string|max:255',
        'fabric' => 'nullable|string|max:255',
        'color' => 'nullable|string|max:255',
        'length' => 'nullable|string|max:255',
'blouse' => 'nullable|string|max:255',
'occasion' => 'nullable|string|max:255',
        'sku' => 'nullable|string|max:255',
        'stock' => 'required|integer|min:0',
        'in_stock' => 'boolean',
        'is_active' => 'boolean',
        'return_exchange' => 'nullable|string',
        'manufactured_by' => 'nullable|string|max:255',
        'marketed_by' => 'nullable|string|max:255',
        'video' => 'nullable',
    ]);
    if ($request->hasFile('image')) {
        $validated['image'] = $request->file('image')->store('products', 'public');
    } elseif ($request->hasFile('images') && count($request->file('images')) > 0) {
        $validated['image'] = $request->file('images')[0]->store('products', 'public');
    }
    if ($request->hasFile('video')) {
        $validated['video'] = $request->file('video')->store('videos', 'public');
    }

    $originalPrice = (float) $validated['original_price'];
    $discount = (float) ($validated['discount'] ?? 0);

    $validated['price'] = $originalPrice - ($originalPrice * $discount / 100);

    $product = Product::create($validated);

if ($request->hasFile('images')) {
    foreach ($request->file('images') as $image) {
        $path = $image->store('products', 'public');

        ProductImage::create([
            'product_id' => $product->id,
            'image' => $path,
        ]);
    }
}

return response()->json(
    $product->load('images'),
    201
);
}

   public function show(Product $product)
{
    return response()->json(
        $product->load('images')
    );
}

   public function update(Request $request, Product $product)
{
    $validated = $request->validate([
        'name' => 'sometimes|string|max:255',
        'description' => 'nullable|string',
        'original_price' => 'sometimes|numeric|min:0',
        'discount' => 'nullable|numeric|min:0|max:100',
        'category' => 'sometimes|string|max:255',
        'image' => 'nullable|image|max:5120',
        'images' => 'nullable|array',
'images.*' => 'image|mimes:jpeg,png,jpg,webp|max:5120',
        'badge' => 'nullable|string|max:255',
        'fabric' => 'nullable|string|max:255',
        'color' => 'nullable|string|max:255',
        'length' => 'nullable|string|max:255',
'blouse' => 'nullable|string|max:255',
'occasion' => 'nullable|string|max:255',
        'sku' => 'nullable|string|max:255|unique:products,sku,' . $product->id,
        'stock' => 'sometimes|integer|min:0',
        'in_stock' => 'boolean',
        'is_active' => 'boolean',
        'return_exchange' => 'nullable|string',
        'manufactured_by' => 'nullable|string|max:255',
        'marketed_by' => 'nullable|string|max:255',
    ]);

    if ($request->hasFile('image')) {
    $validated['image'] = $request->file('image')->store('products', 'public');
}

    $originalPrice = array_key_exists('original_price', $validated)
        ? (float) $validated['original_price']
        : (float) $product->original_price;

    $discount = array_key_exists('discount', $validated)
        ? (float) ($validated['discount'] ?? 0)
        : (float) ($product->discount ?? 0);

    if (
        array_key_exists('original_price', $validated) ||
        array_key_exists('discount', $validated)
    ) {
        $validated['price'] =
            $originalPrice - ($originalPrice * $discount / 100);
    }

    $product->update($validated);

    return response()->json($product);
}
    public function destroy(Product $product)
    {
        $product->delete();

        return response()->json([
            'message' => 'Product deleted successfully'
        ]);
    }
}
