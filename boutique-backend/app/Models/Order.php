<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    public const STATUSES = [
        'Pending',
        'Confirmed',
        'Packed',
        'Shipped',
        'Out for Delivery',
        'Delivered',
        'Cancelled',
    ];

    public const DELIVERY_TIMELINE_DAYS = 6;

    protected $fillable = [
        'user_id',
        'order_number',
        'customer_name',
        'customer_phone',
        'customer_address',
        'total_amount',
        'status',
        'payment_status',
        'expected_delivery_date',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'expected_delivery_date' => 'date:Y-m-d',
    ];

    public function getExpectedDeliveryDateAttribute($value): ?string
    {
        if ($this->status === 'Cancelled') {
            return null;
        }

        if ($value) {
            return is_string($value)
                ? substr($value, 0, 10)
                : ($value instanceof \DateTimeInterface ? $value->format('Y-m-d') : (string) $value);
        }

        if ($this->created_at) {
            return \Illuminate\Support\Carbon::parse($this->created_at)->addDays(self::DELIVERY_TIMELINE_DAYS)->format('Y-m-d');
        }

        return null;
    }

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function statusHistory()
    {
        return $this->hasMany(OrderStatusHistory::class)->latest();
    }
}

