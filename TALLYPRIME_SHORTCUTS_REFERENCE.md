# TALLYPRIME_SHORTCUTS_REFERENCE.md — official TallyPrime shortcut map (REFERENCE ONLY)

> **Status: CAPTURED INPUT — DO NOT IMPLEMENT FROM THIS FILE DIRECTLY.**
> Operator directive (2026-09-24): *"do not implement this yet just remember it. we will research how to implement this for our setup to match the workflow and shortcuts as close as possible to tallyprime."*
> A future R-item must run a **joint design pass** (workflow mapping → conflict resolution → phased adoption) before any code changes. This file is the raw source material for that pass, not a spec.
>
> **Source:** TallyHelp — "How to Use Keyboard Shortcuts in TallyPrime", https://help.tallysolutions.com/tally-prime/keyboard-shortcuts/keyboard-shortcuts-tally-prime/ — documentation stated as updated **18 September 2026**, checked by the operator on 2026-09-24.

---

## 1. Global / across TallyPrime

| Shortcut            | Action                                     |
| ------------------- | ------------------------------------------ |
| **F1**              | Help menu                                  |
| **Ctrl+F1**         | Contextual TallyHelp                       |
| **F2**              | Change voucher date / report period        |
| **Alt+F2**          | Change company period                      |
| **F3**              | Switch to another open company             |
| **Alt+F3**          | Open another company                       |
| **Ctrl+F3**         | Shut currently loaded companies            |
| **F11**             | Company Features                           |
| **F12**             | Report/view configuration                  |
| **Esc**             | Back / close current screen / clear input  |
| **Ctrl+Q**          | Exit screen/application                    |
| **Alt+F4**          | Quit application                           |
| **Ctrl+A**          | Accept / save                              |
| **Alt+G**           | Go To — reports, masters, vouchers, etc.   |
| **Ctrl+G**          | Switch To another report                   |
| **Alt+K**           | Company menu                               |
| **Alt+Y**           | Company data management                    |
| **Alt+Z**           | Exchange/send data                         |
| **Alt+O**           | Import menu                                |
| **Alt+M**           | Share menu                                 |
| **Alt+P**           | Print menu                                 |
| **Alt+E**           | Export menu                                |
| **Ctrl+E**          | Export current voucher/report              |
| **Ctrl+M**          | E-mail current voucher/report              |
| **Ctrl+Alt+W**      | WhatsApp current voucher/report            |
| **Ctrl+P**          | Print current voucher/report               |
| **Ctrl+K**          | Display language                           |
| **Ctrl+W**          | Data-entry language                        |
| **Ctrl+N**          | Calculator                                 |
| **Alt+T**           | Hide/show table details                    |
| **Alt+F**           | Find bar                                   |
| **Ctrl+Alt+N**      | Notifications                              |
| **Ctrl+Alt+R**      | Rewrite data                               |
| **Ctrl+Alt+B**      | Build information                          |
| **Ctrl+Alt+T**      | TDL/add-on details                         |
| **Alt+Enter**       | Expand/collapse group in a table           |
| **Ctrl+Home**       | First field/line                           |
| **Ctrl+End**        | Last field/line                            |
| **Ctrl+Up/Down**    | First/last menu in section                 |
| **Ctrl+Left/Right** | Left/right-most top menu                   |
| **Home / PgUp**     | First line/list                            |
| **End / PgDn**      | Last line/list                             |
| **Home**            | Beginning of text in field                 |
| **End**             | End of text in field                       |
| **↑ / ↓**           | Previous/next field or line                |
| **← / →**           | Previous/next column/menu or text position |

## 2. Navigation between records

| Shortcut      | Action                                                      |
| ------------- | ----------------------------------------------------------- |
| **Page Up**   | Previous master/voucher; scroll report up                   |
| **Page Down** | Next master/voucher; scroll report down                     |
| **+**         | Next artifact / next report / increment report date         |
| **-**         | Previous artifact / previous report / decrement report date |
| **Tab**       | Next input field                                            |
| **Shift+Tab** | Previous input field                                        |
| **Backspace** | Remove typed value                                          |

## 3. Voucher shortcuts

### Open vouchers

| Shortcut    | Voucher        |
| ----------- | -------------- |
| **F4**      | Contra         |
| **F5**      | Payment        |
| **F6**      | Receipt        |
| **F7**      | Journal        |
| **F8**      | Sales          |
| **F9**      | Purchase       |
| **Alt+F5**  | Debit Note     |
| **Alt+F6**  | Credit Note    |
| **Alt+F7**  | Stock Journal  |
| **Alt+F8**  | Delivery Note  |
| **Alt+F9**  | Receipt Note   |
| **Ctrl+F4** | Payroll        |
| **Ctrl+F5** | Rejection Out  |
| **Ctrl+F6** | Rejection In   |
| **Ctrl+F7** | Physical Stock |
| **Ctrl+F8** | Sales Order    |
| **Ctrl+F9** | Purchase Order |

### Voucher actions

| Shortcut       | Action                                                    |
| -------------- | --------------------------------------------------------- |
| **Ctrl+A**     | Save/accept voucher                                       |
| **Alt+D**      | Delete voucher                                            |
| **Alt+X**      | Cancel voucher                                            |
| **Ctrl+D**     | Remove item/ledger line                                   |
| **Ctrl+T**     | Mark post-dated                                           |
| **Ctrl+L**     | Mark optional                                             |
| **Ctrl+H**     | Change voucher mode                                       |
| **Ctrl+I**     | More details for current master/voucher                   |
| **Ctrl+F**     | Autofill statutory voucher details                        |
| **Ctrl+O**     | Related Reports                                           |
| **Alt+A**      | GST Tax Analysis                                          |
| **Alt+J**      | Statutory adjustment                                      |
| **Alt+S**      | Stock Query                                               |
| **Alt+C**      | Calculator / create master on the fly                     |
| **Alt+V**      | Open Manufacturing Journal from journal quantity field    |
| **Alt+R**      | Retrieve previous narration for same party                |
| **Ctrl+R**     | Retrieve previous narration for same voucher type         |
| **F10**        | List of vouchers/masters                                  |
| **Ctrl+Alt+U** | Unused voucher-number details                             |
| **Ctrl+Enter** | Alter master / open voucher for display depending context |
| **Page Up**    | Previous voucher/master                                   |
| **Page Down**  | Next voucher/master                                       |
| **Alt+L**      | Create party using GSTIN/UIN from Excel — TallyPrime 7.0+ |

## 4. Reports

| Shortcut                    | Action                                                    |
| --------------------------- | --------------------------------------------------------- |
| **Enter**                   | Drill down/open voucher or master                         |
| **Ctrl+Enter**              | Open voucher for display / alter master depending context |
| **Space**                   | Select/deselect line                                      |
| **Shift+Space**             | Select/deselect line                                      |
| **Shift+Space + PgUp/PgDn** | Continuous multiple-row selection                         |
| **Ctrl+Shift+Home**         | Select/deselect through top                               |
| **Ctrl+Shift+End**          | Select/deselect through bottom                            |
| **Ctrl+Alt+I**              | Invert selection                                          |
| **Shift+Up/Down**           | Linear multi-row selection                                |
| **Alt+I**                   | Insert voucher                                            |
| **Alt+2**                   | Duplicate voucher                                         |
| **Alt+A**                   | Add voucher                                               |
| **Alt+D**                   | Delete                                                    |
| **Alt+X**                   | Cancel voucher                                            |
| **Ctrl+R**                  | Remove line                                               |
| **Alt+U**                   | Restore hidden lines                                      |
| **Ctrl+U**                  | Restore last hidden line                                  |
| **Alt+F1**                  | Detailed/condensed view                                   |
| **Alt+F5**                  | Detailed/condensed view                                   |
| **Alt+C**                   | Add column                                                |
| **Alt+A**                   | Alter column                                              |
| **Alt+D**                   | Delete column                                             |
| **Alt+N**                   | Auto-repeat columns                                       |
| **Ctrl+F**                  | Filter report — TallyPrime 3.0+                           |
| **Ctrl+Alt+F**              | Filter Details — TallyPrime 7.0+                          |
| **Alt+F**                   | Filter Details — older versions                           |
| **Ctrl+F > F7**             | Calculate balances using filtered vouchers                |
| **Ctrl+B**                  | Change value/balance view                                 |
| **Ctrl+H**                  | Change report view                                        |
| **Ctrl+J**                  | Report exceptions                                         |
| **Shift+Enter**             | Expand/collapse report information                        |
| **+**                       | Next artifact/report/date                                 |
| **-**                       | Previous artifact/report/date                             |

**Important distinction (from the source):** current TallyPrime uses
`Alt+F` = Find/search · `Ctrl+F` = Filter · `Ctrl+Alt+F` = Filter Details (7.0+).
These must **not** be treated as the same operation.

## 5. GST

| Shortcut    | Action                                                    |
| ----------- | --------------------------------------------------------- |
| **F5**      | Nature View ↔ Return View                                 |
| **F6**      | Validate GSTIN/UIN                                        |
| **F7**      | Validate HSN/SAC                                          |
| **Ctrl+V**  | Update HSN/SAC details                                    |
| **F8**      | Validate HSN/SAC voucher-wise/master-wise                 |
| **F10**     | Mark GSTR-1/GSTR-3B filed                                 |
| **Alt+F10** | Undo filing                                               |
| **Alt+J**   | Statutory adjustment                                      |
| **Alt+L**   | Return Effective Date                                     |
| **Alt+F8**  | Include post-dated transactions in relevant ledger report |

## 6. Banking (highly context-dependent)

| Shortcut   | Action                                     |
| ---------- | ------------------------------------------ |
| **F6**     | New/reconnect bank connection              |
| **F7**     | Manage bank connection                     |
| **F10**    | Refresh bank connection                    |
| **F9**     | Manage online payments                     |
| **Alt+L**  | Transaction limits                         |
| **F8**     | Approve user access                        |
| **Alt+F8** | Disable user access                        |
| **F9**     | Set reconciliation status                  |
| **F8**     | Modify matches                             |
| **F10**    | Remove linked transactions                 |
| **Alt+F8** | Unlink transactions                        |
| **Alt+R**  | Manual reconciliation                      |
| **F5**     | View reconciled transactions               |
| **F4**     | Change bank ledger                         |
| **F6**     | View imported bank data monthly            |
| **Alt+F6** | View imported bank data quarterly          |
| **C**      | Connect to bank                            |
| **D**      | Disconnect from bank                       |
| **S**      | Refresh bank connection in Connect to Bank |

The same key can perform different actions in different banking screens.

## 7. Dashboard

| Shortcut      | Action         |
| ------------- | -------------- |
| **Ctrl+Down** | Move down      |
| **Ctrl+Up**   | Move up        |
| **Alt+A**     | Add tile       |
| **Alt+D**     | Remove tile    |
| **Alt+V**     | Expand tile    |
| **Alt+C**     | Configure tile |
| **F3**        | Change company |

## 8. IMS — TallyPrime 7.0+

| Shortcut  | Action                                |
| --------- | ------------------------------------- |
| **F6**    | Default IMS View                      |
| **F7**    | Reconciliation View                   |
| **F8**    | Action View                           |
| **F9**    | Books View                            |
| **F10**   | Set IMS Action Status                 |
| **Alt+Q** | View vouchers available only in books |

## 9. Notifications

| Shortcut       | Action                    |
| -------------- | ------------------------- |
| **Ctrl+Alt+N** | Open Notifications        |
| **Alt+D**      | Dismiss notification      |
| **Ctrl+R**     | Remove notification line  |
| **Ctrl+U**     | Restore notification line |

## 10. Backup / TallyDrive

| Shortcut   | Action                    |
| ---------- | ------------------------- |
| **F6**     | Instant backup            |
| **F7**     | Refresh backup schedule   |
| **Alt+A**  | Add backup schedule       |
| **F6**     | Extend TallyDrive storage |
| **F7**     | Manage user rights        |
| **Alt+F6** | Refresh storage           |
| **F8**     | Resend Recovery Key       |
| **F9**     | Download backup           |
| **Alt+F9** | Download all backups      |

## 11. Currency symbols

| Currency           | Shortcut                      |
| ------------------ | ----------------------------- |
| **₹ Indian Rupee** | **Ctrl+4**                    |
| **UAE Dirham**     | **Ctrl+Shift+6**              |
| **Saudi Riyal**    | **Ctrl+Shift+7**              |
| **£ Pound**        | Alt+0163 on extended keyboard |
| **€ Euro**         | Alt+0128 on extended keyboard |
| **¥ Yen**          | Alt+0165 on extended keyboard |

## 12. Templates / Invoice Printing

Applicable to Sales, POS, Sales Order, Delivery Note, Credit Note and Debit Note templates.

| Shortcut   | Action                            |
| ---------- | --------------------------------- |
| **Ctrl+H** | Change template                   |
| **Alt+R**  | Print without colour              |
| **Alt+T**  | Tally Classic format              |
| **F2**     | Template list                     |
| **F4**     | Add/remove fields                 |
| **F5**     | Watermark                         |
| **F6**     | Header image                      |
| **Alt+F6** | Footer image                      |
| **F7**     | Custom fields                     |
| **F8**     | Font/colour                       |
| **F9**     | Field properties                  |
| **F10**    | Print settings                    |
| **Ctrl+L** | Save template                     |
| **Alt+L**  | Set default template              |
| **Alt+S**  | Copy Classic-format configuration |

## 13. E-mail

| Shortcut   | Action                             |
| ---------- | ---------------------------------- |
| **L**      | Login via browser                  |
| **Ctrl+P** | Login with App Password            |
| **F9**     | Configure email                    |
| **F8**     | Select file format                 |
| **E**      | Reset email login                  |
| **S**      | Verify login/send email            |
| **Alt+S**  | Select predefined message template |

## 14. Docs by Ira / imported transactions

| Shortcut   | Action                    |
| ---------- | ------------------------- |
| **F10**    | Save vouchers             |
| **Ctrl+F** | Autofill vouchers         |
| **Alt+I**  | View imported file        |
| **F7**     | Refresh                   |
| **Ctrl+S** | View potential duplicates |
| **Alt+S**  | Configure duplicates      |
| **F6**     | Update mapping            |
| **F9**     | Set dates                 |
| **F8**     | Set account ledger        |

## 15. E-Invoice / E-Way Bill (screen-specific inline actions)

| Shortcut | Action                                     |
| -------- | ------------------------------------------ |
| **S**    | Send transactions for generation           |
| **X**    | Export transactions for offline generation |
| **I**    | Cancel e-Invoice/e-Way Bill + voucher      |

## 16. Additional context-specific shortcuts

TallyPrime's official list is much larger because many screens have their own shortcuts. Examples:

| Shortcut   | Context/action                                       |
| ---------- | ---------------------------------------------------- |
| **Alt+B**  | Download payee sample file                           |
| **Alt+W**  | Update email/employee sample depending screen        |
| **Alt+Q**  | Edit Log / context-specific action                   |
| **Alt+S**  | Various context-specific actions                     |
| **Alt+R**  | Various context-specific actions                     |
| **Alt+V**  | Various context-specific actions                     |
| **Alt+U**  | Various context-specific actions                     |
| **F5–F10** | Frequently reused as contextual right-button actions |

**Key insight (operator's source):** TallyPrime's shortcut system is **not simply one global keyboard map** — the same key can have a different function depending on the current report or screen.

## The important Gateway point (operator's source, verbatim intent)

The official TallyPrime shortcut page does **not** list a universal table such as `K = Day Book`, `R = Reports`, `M = Masters` as global shortcuts. What Tally officially documents is the broader menu/navigation system, plus **Alt+G = Go To** and **Ctrl+G = Switch To**. Individual single-letter keys do exist in many context-specific inline/menu actions (`S`, `C`, `D`, `E`, `X`, …).

Categories to keep separate when designing zprime's keyboard system:

```text
1. GLOBAL TALLYPRIME SHORTCUT      — e.g. F8 = Sales
2. CONTEXTUAL TALLYPRIME SHORTCUT  — e.g. S = Send, only in a particular screen
3. MENU / MNEMONIC NAVIGATION      — highlighted menu letters
4. ZPRIME PROPOSED GATEWAY HOTKEY  — e.g. K = Day Book, R = Reports (zprime invention)
```

---

## First-pass observations for the future research pass (NOT decisions)

Recorded 2026-09-24 from verified zprime current state; the joint pass must re-verify each:

**Already aligned with TallyPrime:**
- Voucher opening: F5 Payment / F8 Sales / F9 Purchase (Gateway rail + Day Book), Alt+F5 DN / Alt+F6 CN / Alt+F7 SJ / Alt+F8 DN / Alt+F9 RN / Ctrl+F7 Physical Stock (R-34 wired the six advertised chords).
- F2 = date/period (Day Book date focus; inert on Gateway — R-53c).
- Ctrl+A = Accept/Save (voucher). Alt+C = create master on the fly (R-35 quick-create — same key, matching intent).
- Esc = back/close (Shell history-back + modal claims, R-53c/v1.50.1; Gateway as last stop is Tally-like).
- Single-letter Alt chord infrastructure exists (hotkeys.ts maps `Alt+<letter>`, R-23 Alt+R) — the Tally Alt+letter family (Alt+E/O/M/P/Y/K/Z…) is mechanically reachable.
- Report drill-down via Enter; arrows in grids (R-36).

**Known conflicts to resolve in the design pass:**
- **Alt+G**: zprime uses it on vouchers to apply GST (R-34, "posts both halves"); Tally uses Alt+G globally for **Go To**. Highest-impact conflict — Go To is Tally's universal navigator.
- **Ctrl+H**: zprime maps Ctrl+H (unbalanced-voucher context); Tally = change voucher mode / change report view.
- **Alt+T**: zprime = apply TDS on Accounting vouchers; Tally = hide/show table details (and Alt+T context actions elsewhere).
- **Alt+R**: zprime = reverse-charge toggle (R-23); Tally = retrieve previous narration / print-without-colour / manual reconciliation (contextual).
- **Gateway hot letters (V/K/C/A/R/U + item letters, digits)** are zprime's own mnemonic layer (category 4) — official Tally has no such global table; decide whether to keep, reshape around Go To, or both.

**Browser-constrained keys (R-51/PWA context applies):** F1/F11/F12 (browser-consumed in tab view; app-mode helps), Ctrl+N (new window — effectively uninterceptable), Ctrl+P/Ctrl+S (print/save dialogs in tab view), Alt+F4 (OS-level), Ctrl+W (browser tab close). Any Tally parity for these needs the PWA/app-window path documented in README, or alternative bindings.

**Gaps zprime does not cover at all yet (candidates, not commitments):** Go To (Alt+G) as a universal navigator; F3 company switcher; F11/F12-style features/configuration surfaces; +/− next/previous artifact & report-date stepping; Alt+F1 detailed/condensed (zprime uses Alt+F1 on voucher screens only); report filter (Ctrl+F) family; Alt+D delete / Alt+X cancel on vouchers (zprime deletes via Day Book UI today).
