<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $fillable = [
        'name',
        'description',
        'price',
        'original_price',
        'discount',
        'category',
        'image',
        'badge',
        'fabric',
        'color',
        'length',
         'blouse',
         'occasion',
        'sku',
        'stock',
        'in_stock',
        'is_active',
        'return_exchange',
        'manufactured_by',
        'marketed_by',
        'video',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'original_price' => 'decimal:2',
        'discount' => 'decimal:2',
        'stock' => 'integer',
        'in_stock' => 'boolean',
        'is_active' => 'boolean',
    ];
    public function images()
{
    return $this->hasMany(ProductImage::class);
}
}