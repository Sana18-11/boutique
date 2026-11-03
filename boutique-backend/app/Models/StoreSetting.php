<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StoreSetting extends Model
{
    protected $fillable = [
        'store_name',
        'store_email',
        'store_phone',
        'store_address',
        'shipping_fee',
        'free_shipping_threshold',
        'return_policy',
        'shipping_policy',
        'privacy_policy',
        'terms_policy',
    ];

    protected $casts = [
        'shipping_fee' => 'decimal:2',
        'free_shipping_threshold' => 'decimal:2',
    ];

    public static function current(): self
    {
        $settings = self::query()->find(1);
        if ($settings) {
            return $settings;
        }

        $settings = new self();
        $settings->id = 1;
        $settings->save();

        return $settings;
    }
}