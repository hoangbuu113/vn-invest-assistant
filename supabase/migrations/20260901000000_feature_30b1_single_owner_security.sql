-- Feature 30B1: single-owner backend authority and private database boundary.
-- The public application may read canonical asset/provider metadata only.
-- Personal state is reachable exclusively through the authenticated backend,
-- which uses the server-only service_role client.

BEGIN;

DROP POLICY IF EXISTS "Allow public read access to investor_profile" ON public.investor_profile;
DROP POLICY IF EXISTS "Allow public insert access to investor_profile" ON public.investor_profile;
DROP POLICY IF EXISTS "Allow public update access to investor_profile" ON public.investor_profile;

DROP POLICY IF EXISTS "Allow public read access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public insert access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public update access to holdings" ON public.holdings;
DROP POLICY IF EXISTS "Allow public delete access to holdings" ON public.holdings;

DROP POLICY IF EXISTS "Allow public read access to watchlist_items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Allow public insert access to watchlist_items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Allow public delete access to watchlist_items" ON public.watchlist_items;

DROP POLICY IF EXISTS "Allow public read access to price_alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Allow public insert access to price_alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Allow public update access to price_alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Allow public delete access to price_alerts" ON public.price_alerts;

DROP POLICY IF EXISTS "Allow public read access to portfolio_transactions" ON public.portfolio_transactions;
DROP POLICY IF EXISTS "Allow public read access to position_opening_baselines" ON public.position_opening_baselines;

REVOKE ALL PRIVILEGES ON TABLE
  public.investor_profile,
  public.holdings,
  public.watchlist_items,
  public.price_alerts,
  public.portfolio_transactions,
  public.cash_ledger_activation,
  public.cash_ledger_entries,
  public.position_ledger_activation,
  public.position_opening_baselines
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.investor_profile,
  public.holdings,
  public.watchlist_items,
  public.price_alerts,
  public.portfolio_transactions,
  public.cash_ledger_activation,
  public.cash_ledger_entries,
  public.position_ledger_activation,
  public.position_opening_baselines
TO service_role;

REVOKE ALL ON FUNCTION public.enforce_vnd_portfolio_transaction_asset()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initialize_cash_ledger_account()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calculate_cash_ledger_balance(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_portfolio_transactions(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cash_overview()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_cash_ledger_entries()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cash_movement(TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_investor_profile_preferences(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_opening_position(TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_portfolio_transaction(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_portfolio_transactions(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cash_overview()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_cash_ledger_entries()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_cash_movement(TEXT, NUMERIC)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_investor_profile_preferences(TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_opening_position(TEXT, NUMERIC, NUMERIC)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_opening_position(TEXT, NUMERIC, NUMERIC)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_opening_position(TEXT)
  TO service_role;

COMMIT;
