INSERT OR IGNORE INTO content_modes (id, label, access_state, is_enabled, is_default_public, sort_order)
VALUES
  ('home_mode', 'Home', 'public', 1, 1, 10),
  ('proxies_mode', 'Proxies', 'locked', 1, 0, 20),
  ('admin_mode', 'Admin', 'locked', 1, 0, 30);

INSERT OR IGNORE INTO site_settings (key, value_json)
VALUES
  ('donate.visible', 'true'),
  ('panic_mode', 'false');

INSERT OR IGNORE INTO wallets (id, network, title, address, qr_payload, warning_text, is_enabled, sort_order)
VALUES
  ('ton', 'ton', 'usdt ton', 'set-in-admin', 'set-in-admin', 'send only usdt on ton network', 1, 10),
  ('trc20', 'trc20', 'usdt trc20', 'set-in-admin', 'set-in-admin', 'send only usdt on trc20 network', 1, 20),
  ('erc20', 'erc20', 'usdt erc20', 'set-in-admin', 'set-in-admin', 'send only usdt on erc20 network', 1, 30),
  ('sol', 'sol', 'usdt sol', 'set-in-admin', 'set-in-admin', 'send only usdt on sol network', 1, 40);

INSERT OR IGNORE INTO proxy_state (id, last_refresh_status, panic_mode, session_version)
VALUES (1, 'booting', 0, 1);
