/* ═══════════════════════════════════════════════════════
   SNIPPET UNTUK app.js — navigateTo hook AI Sensei
   Cari fungsi navigateTo(page) yang sudah ada di app.js,
   lalu TAMBAHKAN blok berikut di dalamnya, setelah
   baris:  STATE.currentPage = page;

   Contoh lokasi (sekitar baris 6050):
   ─────────────────────────────────────────────────────
   function navigateTo(page) {
       ...
       STATE.currentPage = page;
       // ↓ TAMBAHKAN INI ↓
       if (page === 'ai-sensei') {
           requestAnimationFrame(() => {
               if (window.AI_SENSEI) AI_SENSEI.init();
           });
       }
       ...
   }
   ═══════════════════════════════════════════════════════ */

// BLOK YANG DITAMBAHKAN (paste ke dalam navigateTo, setelah STATE.currentPage = page):
if (page === 'ai-sensei') {
    requestAnimationFrame(() => {
        if (window.AI_SENSEI) AI_SENSEI.init();
    });
}
