<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
         Schema::table('products', function (Blueprint $table) {
        $table->decimal('original_price', 10, 2)->nullable()->after('price');
        $table->string('badge')->nullable()->after('image');
        $table->string('fabric')->nullable()->after('category');
        $table->string('color')->nullable()->after('fabric');
        $table->string('sku')->nullable()->unique()->after('color');
        $table->boolean('in_stock')->default(true)->after('stock');
        $table->text('return_exchange')->nullable()->after('description');
        $table->string('manufactured_by')->nullable()->after('return_exchange');
        $table->string('marketed_by')->nullable()->after('manufactured_by');
    });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
       Schema::table('products', function (Blueprint $table) {
        $table->dropColumn([
            'original_price',
            'badge',
            'fabric',
            'color',
            'sku',
            'in_stock',
            'return_exchange',
            'manufactured_by',
            'marketed_by',
        ]);
    });
    }
};
