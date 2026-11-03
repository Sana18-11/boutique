<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Video extends Model
{
    protected $fillable = [
        'title',
        'video',
        'poster',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];
}
