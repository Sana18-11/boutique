<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Product;

class ProductSeeder extends Seeder
{
    public function run(): void
    {
        $products = [
            [
                'name' => 'Kanjivaram Zari Silk',
                'category' => 'Soft Silk',
                'price' => 18500,
                'original_price' => 22000,
                'image' => 'https://images.unsplash.com/photo-1614940685083-c5409b57da6e?w=600&h=800&fit=crop&auto=format',
                'badge' => 'NEW',
                'fabric' => 'Pure Silk',
                'color' => 'Marigold',
                'sku' => 'SS-001',
                'stock' => 1,
                'in_stock' => true,
                'is_active' => true,
            ],

            [
                'name' => 'Mysore Crepe Silk',
                'category' => 'Soft Silk',
                'price' => 12800,
                'original_price' => null,
                'image' => 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600&h=800&fit=crop&auto=format',
                'badge' => 'BESTSELLER',
                'fabric' => 'Crepe Silk',
                'color' => 'Crimson',
                'sku' => 'SS-002',
                'stock' => 1,
                'in_stock' => true,
                'is_active' => true,
            ],

            [
                'name' => 'Venkatgiri Pure Cotton',
                'category' => 'Cotton',
                'price' => 4200,
                'original_price' => 5500,
                'image' => 'http://localhost:8443/brown-cotton-saree.webp',
                'badge' => 'SALE',
                'fabric' => 'Handloom Cotton',
                'color' => 'Ivory',
                'sku' => 'CO-001',
                'stock' => 1,
                'in_stock' => true,
                'is_active' => true,
            ],

            [
                'name' => 'Tant Bengal Weave',
                'category' => 'Cotton',
                'price' => 3800,
                'original_price' => null,
                'image' => 'https://images.unsplash.com/photo-1572470176170-98fa8abcb741?w=600&h=800&fit=crop&auto=format',
                'badge' => 'NEW',
                'fabric' => 'Cotton',
                'color' => 'Ebony',
                'sku' => 'CO-002',
                'stock' => 1,
                'in_stock' => true,
                'is_active' => true,
            ],

            [
                'name' => 'Semi Silk Chanderi',
                'category' => 'Semi Silk',
                'price' => 7500,
                'original_price' => 9000,
                'image' => 'http://localhost:8443/semi-silk-saree.webp',
                'badge' => 'NEW',
                'fabric' => 'Chanderi',
                'color' => 'Amber',
                'sku' => 'SM-001',
                'stock' => 1,
                'in_stock' => true,
                'is_active' => true,
            ],

            [
                'name' => 'Banarasi Georgette',
                'category' => 'Semi Silk',
                'price' => 9800,
                'original_price' => null,
                'image' => 'https://images.unsplash.com/photo-1618489335755-e3aa2b16cd7a?w=600&h=800&fit=crop&auto=format',
                'badge' => 'BESTSELLER',
                'fabric' => 'Georgette',
                'color' => 'Ruby',
                'sku' => 'SM-002',
                'stock' => 1,
                'in_stock' => true,
                'is_active' => true,
            ],

            [
                'name' => 'Paithani Art Silk',
                'category' => 'Soft Silk',
                'price' => 15200,
                'original_price' => 18000,
                'image' => 'https://images.unsplash.com/photo-1660669996485-f4713e9c8f01?w=600&h=800&fit=crop&auto=format',
                'badge' => 'SALE',
                'fabric' => 'Art Silk',
                'color' => 'Peacock Blue',
                'sku' => 'SS-003',
                'stock' => 1,
                'in_stock' => true,
                'is_active' => true,
            ],

            [
                'name' => 'Handloom Ikat Cotton',
                'category' => 'Cotton',
                'price' => 5600,
                'original_price' => null,
                'image' => 'https://images.unsplash.com/photo-1630880276407-7e0c38d4df24?w=600&h=800&fit=crop&auto=format',
                'badge' => 'NEW',
                'fabric' => 'Ikat Cotton',
                'color' => 'Indigo',
                'sku' => 'CO-003',
                'stock' => 0,
                'in_stock' => false,
                'is_active' => true,
            ],
        ];

        foreach ($products as $product) {
            Product::updateOrCreate(
                ['sku' => $product['sku']],
                $product
            );
        }
    }
}
