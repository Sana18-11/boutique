<?php

use App\Http\Controllers\AddressController;
use App\Http\Controllers\AdminAuthController;
use App\Http\Controllers\AdminDashboardController;
use App\Http\Controllers\CategoryController;
use App\Http\Controllers\ContactMessageController;
use App\Http\Controllers\CustomerController;
use App\Http\Controllers\CustomerAuthController;
use App\Http\Controllers\CustomerRegistrationController;
use App\Http\Controllers\OfferController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\StoreSettingController;
use App\Http\Controllers\VideoController;
use App\Http\Controllers\WishlistController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::apiResource('products', ProductController::class);
Route::get('/contact-messages', [ContactMessageController::class, 'index'])->middleware(['auth:sanctum', 'admin']);
Route::patch('/contact-messages/{message}/read', [ContactMessageController::class, 'markAsRead'])->middleware(['auth:sanctum', 'admin']);
Route::post('/contact-messages', [ContactMessageController::class, 'store']);
Route::apiResource('categories', CategoryController::class)->only([
    'index',
    'store',
    'update',
    'destroy',
]);

Route::post('/orders', [OrderController::class, 'store'])->middleware(['auth:sanctum', 'customer']);
Route::get('/orders', [OrderController::class, 'index'])->middleware('auth:sanctum');
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::match(['put', 'patch'], '/orders/{order}', [OrderController::class, 'update']);
    Route::delete('/orders/{order}', [OrderController::class, 'destroy']);
});
Route::get('/customers', [CustomerController::class, 'index'])->middleware(['auth:sanctum', 'admin']);
Route::post('/register', [CustomerRegistrationController::class, 'store'])->middleware('throttle:5,1');
Route::post('/customer/login', [CustomerAuthController::class, 'login'])->middleware('throttle:5,1');
Route::get('/settings', [StoreSettingController::class, 'show']);
Route::apiResource('offers', OfferController::class)->only([
    'index',
    'store',
    'update',
    'destroy',
]);

Route::post('/admin/login', [AdminAuthController::class, 'login'])->middleware('throttle:5,1');
Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
    Route::get('/dashboard', [AdminDashboardController::class, 'stats']);
    Route::get('/stats', [AdminDashboardController::class, 'stats']);
    Route::post('/logout', [AdminAuthController::class, 'logout']);
    Route::get('/settings', [StoreSettingController::class, 'show']);
    Route::put('/settings', [StoreSettingController::class, 'update']);
});

Route::middleware(['auth:sanctum', 'customer'])->prefix('customer')->group(function () {
    Route::get('/user', [CustomerAuthController::class, 'user']);
    Route::put('/user', [CustomerAuthController::class, 'updateUser']);
    Route::get('/addresses', [AddressController::class, 'index']);
    Route::post('/addresses', [AddressController::class, 'store']);
    Route::put('/addresses/{address}', [AddressController::class, 'update']);
    Route::delete('/addresses/{address}', [AddressController::class, 'destroy']);
    Route::patch('/addresses/{address}/default', [AddressController::class, 'setDefault']);
    Route::get('/orders', [OrderController::class, 'customerIndex']);
    Route::get('/orders/{orderNumber}', [OrderController::class, 'customerShow']);
    Route::get('/wishlist', [WishlistController::class, 'customerIndex']);
    Route::post('/wishlist', [WishlistController::class, 'customerStore']);
    Route::delete('/wishlist/{productId}', [WishlistController::class, 'customerDestroy']);
    Route::post('/logout', [CustomerAuthController::class, 'logout']);
});

Route::get('/wishlist', [WishlistController::class, 'index']);
Route::post('/wishlist', [WishlistController::class, 'store']);
Route::delete('/wishlist/{productId}', [WishlistController::class, 'destroy']);

Route::get('/videos', [VideoController::class, 'index']);
Route::middleware(['auth:sanctum', 'admin'])->group(function () {
    Route::post('/videos', [VideoController::class, 'store']);
    Route::delete('/videos/{id}', [VideoController::class, 'destroy']);
});

Route::get('/debug-upload-settings', function () {
    return response()->json([
        'ini_file' => php_ini_loaded_file(),
        'ini_scanned' => php_ini_scanned_files(),
        'post_max_size' => ini_get('post_max_size'),
        'upload_max_filesize' => ini_get('upload_max_filesize'),
        'sapi' => php_sapi_name(),
    ]);
});
