# Interview log (decisions)

Legend: ✅ decided · ❓ OPEN QUESTION (ask the owner) · 🔮 future phase

## Round 1: Architecture

**Q1. How detailed is a sale record?** ✅
- Each sale is its own row (amount, aba, payment method, machine, installments).
- Each aba shows the sum of its rows.
- Daily and monthly totals are always calculated from the rows. Nobody types totals in.

**Q2. Users and devices** ✅
- Local app on **one shop PC**.
- 🔮 Viewing everything (reports, fixed expenses) on the PC and on the owner's phone is a later improvement, and only if it costs **R$ 0**.
  - Architecture note: build it as a **local web app** (a server running on the PC, used in the browser). That way phone access later is just configuration:
    - on the shop Wi-Fi, through the PC's address on the local network;
    - away from the shop, through a free tunnel or VPN such as Tailscale or Cloudflare Tunnel (to be evaluated).

**Q3. Simultaneous users** ✅
- One person enters data at a time.
- An embedded single-file database (e.g. SQLite) is enough. Read-only viewing from the phone later doesn't change this.

## Round 2: How a sale is paid, and machine fees

**Q4. Split payments and mixed purchases** ✅
- **1 row = 1 aba + 1 payment method.**
- A split payment, or one purchase from several abas, is entered as several rows.

**Q5. Machine fees** ✅
- Fee table by **machine × method (débito, crédito à vista, crédito parcelado, PIX through the machine) × number of installments**.
- Each rate has a "valid from" date. A sale stores the % applied and the net amount, so a later rate change never rewrites old days.
- ❓ OPEN: the current rates for PagSeguro and Mercado Pago.
- ❓ OPEN: does the shop use antecipação?

**Q6. Gross vs net; when money actually arrives** ✅
- **Saldo = Entradas brutas − Taxas de maquininha − Despesas.** Fees appear as their own line.
- Income counts on the **sale date**.
- 🔮 Tracking when card money reaches the bank (D+1, D+30, installments) is a future phase.
