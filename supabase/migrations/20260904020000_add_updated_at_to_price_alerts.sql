-- Migration: Add updated_at column to price_alerts table
-- Aligns price_alerts schema with trigger_price_alert_atomic RPC and standard timestamps

ALTER TABLE public.price_alerts 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
