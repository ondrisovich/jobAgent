# Denní sken nabídek

1. Prohledej české, švýcarské, německé, rakouské a ostatní evropské pracovní portály i kariérní stránky firem. Střídej výrazy PLC, SCADA, DCS, WinCC OA, OPC UA, industrial control systems, automation engineering, procesní řízení a commissioning. Pro Německo a Rakousko zahrň SPS, Prozessleittechnik a Inbetriebnahme. Pro frankofonní zdroje použij automatismes, contrôle-commande a mise en service.
2. Otevři detail nabídky, ověř dostupnost a vyber přímý odkaz. Slouč výsledky z více portálů, které zastupují stejný inzerát. V ostatní Evropě zahrň B2B, offshore a rotační kontrakty. Záznamy ulož ve formátu [ukázkové dávky](examples/jobs.json).
3. Spusť `node sync-jobs.mjs <nabidky.json>` a zkontroluj počet přidaných nabídek po jednotlivých regionech.
4. Projdi původní odkazy dříve uložených nabídek. Do pracovního souboru vlož JSON pole přesných URL pouze u potvrzeně uzavřených pozic. Při dočasné nedostupnosti či nejednoznačném výsledku nabídku ponech. Před vyřazením ověř, zda se inzerát pouze nepřesunul na jinou adresu.
5. Spusť `node sync-jobs.mjs <prazdne-pole.json> <ukoncene-url.json>` a ověř počet odstraněných nabídek. První soubor při tomto kroku obsahuje `[]`.
