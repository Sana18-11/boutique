<?php

namespace Tests\Unit;

use App\Models\Order;
use Carbon\Carbon;
use Tests\TestCase;

class OrderExpectedDeliveryDateTest extends TestCase
{
    public function test_expected_delivery_date_calculated_from_created_at(): void
    {
        $order = new Order([
            'status' => 'Pending',
        ]);
        $order->created_at = Carbon::parse('2026-10-01 10:00:00');

        $this->assertSame('2026-10-07', $order->expected_delivery_date);
    }

    public function test_expected_delivery_date_prefers_explicit_value(): void
    {
        $order = new Order([
            'status' => 'Pending',
            'expected_delivery_date' => '2026-10-15',
        ]);
        $order->created_at = Carbon::parse('2026-10-01 10:00:00');

        $this->assertSame('2026-10-15', $order->expected_delivery_date);
    }

    public function test_expected_delivery_date_is_null_for_cancelled_orders(): void
    {
        $order = new Order([
            'status' => 'Cancelled',
            'expected_delivery_date' => '2026-10-15',
        ]);
        $order->created_at = Carbon::parse('2026-10-01 10:00:00');

        $this->assertNull($order->expected_delivery_date);
    }

    public function test_expected_delivery_date_is_included_in_serialized_array(): void
    {
        $order = new Order([
            'status' => 'Pending',
            'expected_delivery_date' => '2026-10-10',
        ]);
        $order->created_at = Carbon::parse('2026-10-04 10:00:00');

        $array = $order->toArray();
        $this->assertArrayHasKey('expected_delivery_date', $array);
        $this->assertSame('2026-10-10', $array['expected_delivery_date']);
    }

    public function test_expected_delivery_date_returns_null_when_unavailable(): void
    {
        $order = new Order([
            'status' => 'Pending',
        ]);

        $this->assertNull($order->expected_delivery_date);
    }
}
