import catalog from "./translations.json";

export type Language = "en" | "tr" | "fr" | "es";
export const languages = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
] as const;
export const locales: Record<Language, string> = {
  en: "en-US",
  tr: "tr-TR",
  fr: "fr-FR",
  es: "es-ES",
};
export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "tr" || value === "fr" || value === "es";
}
const dictionary: Record<string, string[]> = catalog;

const spanishPatterns: { match: RegExp; render: (m: RegExpMatchArray) => string }[] = [
  { match: /^(\d+) employees in your team$/, render: (m) => `${m[1]} empleados en tu equipo` },
  { match: /^(\d+) shifts with staffing requirements$/, render: (m) => `${m[1]} turnos con necesidades de personal` },
  { match: /^(\d+) constraint violations$/, render: (m) => `${m[1]} incumplimientos de restricciones` },
  { match: /^([\d.]+) hrs?$/, render: (m) => `${formatNumber("es", +m[1])} h` },
  { match: /^Day (\d+)$/, render: (m) => `Día ${m[1]}` },
  { match: /^Employee (\d+) name$/, render: (m) => `Nombre del empleado ${m[1]}` },
  { match: /^(.+) hourly wage$/, render: (m) => `Salario por hora de ${m[1]}` },
  { match: /^(.+) maximum hours$/, render: (m) => `Horas máximas de ${m[1]}` },
  { match: /^Remove (.+)$/, render: (m) => `Eliminar a ${m[1]}` },
  { match: /^(.+) example loaded$/, render: (m) => `Ejemplo de ${translate("es", m[1])} cargado` },
  { match: /^(.+) has overlapping shifts on day (\d+)\.$/, render: (m) => `${m[1]} tiene turnos solapados el día ${m[2]}.` },
  { match: /^(.+) is unavailable for day (\d+) (Morning|Afternoon)\.$/, render: (m) => `${m[1]} no está disponible el día ${m[2]} por la ${translate("es", m[3]).toLowerCase()}.` },
  { match: /^(.+): ([\d.]+)h exceeds the ([\d.]+)h weekly limit\.$/, render: (m) => `${m[1]}: ${formatNumber("es", +m[2])} h supera el límite semanal de ${formatNumber("es", +m[3])} h.` },
  { match: /^(.+) required staff$/, render: (m) => `${m[1]} empleados necesarios` },
  { match: /^Showing 100 changes; all (\d+) are saved with the validated dataset\.$/, render: (m) => `Se muestran 100 cambios; los ${m[1]} se guardan con el conjunto de datos validado.` },
  { match: /^(.+): wage must be \$0–\$1,000 with at most two decimals\.$/, render: (m) => `${m[1]}: el salario debe estar entre 0 y 1.000 USD y tener como máximo dos decimales.` },
  { match: /^(.+): maximum hours must be 0–168 in whole minutes\.$/, render: (m) => `${m[1]}: el límite debe estar entre 0 y 168 horas, en minutos enteros.` },
  { match: /^(.+): availability must cover all 14 shifts\.$/, render: (m) => `${m[1]}: debe indicarse la disponibilidad para los 14 turnos.` },
  { match: /^Day (\d+) (Morning|Afternoon): end time must be after start time on the same day\.$/, render: (m) => `Día ${m[1]}, ${translate("es", m[2])}: la hora de fin debe ser posterior a la de inicio el mismo día.` },
  { match: /^Day (\d+) (Morning|Afternoon): staffing must be a whole number from 0–30\.$/, render: (m) => `Día ${m[1]}, ${translate("es", m[2])}: la dotación debe ser un número entero entre 0 y 30.` },
  { match: /^Day (\d+) (Morning|Afternoon): needs (\d+), but only (\d+) eligible employees are available\.$/, render: (m) => `Día ${m[1]}, ${translate("es", m[2])}: se necesitan ${m[3]} empleados, pero solo hay ${m[4]} disponibles y aptos.` },
  { match: /^Day (\d+) (Morning|Afternoon): (\d+) unfilled position\(s\)\.$/, render: (m) => `Día ${m[1]}, ${translate("es", m[2])}: quedan ${m[3]} puestos sin cubrir.` },
  { match: /^Weekly demand is ([\d.]+) hours; employee limits provide only ([\d.]+) hours\.$/, render: (m) => `La demanda semanal es de ${formatNumber("es", +m[1])} horas; los límites del personal solo permiten ${formatNumber("es", +m[2])} horas.` },
];

// Canonical English messages stay in the model and saved results. Only their
// presentation changes, so an existing result can be switched between languages.
// Captured employee names are deliberately never translated.
type MessagePattern = {
  match: RegExp;
  render: (m: RegExpMatchArray, l: Language) => string;
};
const pick = (l: Language, tr: string, fr: string, es?: string) => (l === "tr" ? tr : l === "fr" ? fr : es || "");
const patterns: MessagePattern[] = [
  {
    match: /^Showing 100 changes; all (\d+) are saved with the validated dataset\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]} değişikliğin 100 tanesi gösteriliyor; tümü doğrulanmış veri kümesiyle kaydedilir.`,
        `100 modifications affichées ; les ${m[1]} sont toutes enregistrées avec le jeu de données validé.`,
      ),
  },
  {
    match: /^(.+) example loaded$/,
    render: (m, l) =>
      pick(
        l,
        `${translate(l, m[1])} örneği yüklendi`,
        `Exemple ${translate(l, m[1])} chargé`,
      ),
  },
  {
    match: /^(\d+) employees in your team$/,
    render: (m, l) =>
      pick(
        l,
        `Ekibinizde ${m[1]} çalışan var`,
        `${m[1]} employé(s) dans votre équipe`,
      ),
  },
  {
    match: /^(\d+) shifts with staffing requirements$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]} vardiyada personel ihtiyacı var`,
        `${m[1]} créneau(x) avec des besoins en personnel`,
      ),
  },
  {
    match: /^(\d+) constraint violations$/,
    render: (m, l) =>
      pick(l, `${m[1]} kısıt ihlali`, `${m[1]} violation(s) de contraintes`),
  },
  {
    match: /^([\d.]+) hrs$/,
    render: (m, l) => `${formatNumber(l, Number(m[1]))} ${pick(l, "sa", "h")}`,
  },
  {
    match: /^([\d.]+)h$/,
    render: (m, l) => `${formatNumber(l, Number(m[1]))} ${pick(l, "sa", "h")}`,
  },
  {
    match: /^Day (\d+)$/,
    render: (m, l) => pick(l, `${m[1]}. gün`, `Jour ${m[1]}`),
  },
  {
    match: /^Employee (\d+) name$/,
    render: (m, l) =>
      pick(l, `${m[1]}. çalışanın adı`, `Nom de l’employé ${m[1]}`),
  },
  {
    match: /^(.+) hourly wage$/,
    render: (m, l) =>
      pick(l, `${m[1]} saatlik ücret`, `Salaire horaire de ${m[1]}`),
  },
  {
    match: /^(.+) maximum hours$/,
    render: (m, l) =>
      pick(l, `${m[1]} azami çalışma süresi`, `Maximum d’heures de ${m[1]}`),
  },
  {
    match: /^Remove (.+)$/,
    render: (m, l) =>
      pick(l, `${m[1]} adlı çalışanı kaldır`, `Supprimer ${m[1]}`),
  },
  {
    match: /^(.+): wage must be \$0–\$1,000 with at most two decimals\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}: ücret 0–1.000 USD arasında ve en fazla iki ondalık basamaklı olmalıdır.`,
        `${m[1]} : le salaire doit être compris entre 0 et 1 000 USD, avec au plus deux décimales.`,
      ),
  },
  {
    match: /^(.+): maximum hours must be 0–168 in whole minutes\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}: azami çalışma süresi 0–168 saat arasında ve tam dakika cinsinden olmalıdır.`,
        `${m[1]} : la limite doit être comprise entre 0 et 168 heures, en minutes entières.`,
      ),
  },
  {
    match: /^(.+): availability must cover all 14 shifts\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}: uygunluk 14 vardiyanın tamamı için tanımlanmalıdır.`,
        `${m[1]} : la disponibilité doit couvrir les 14 créneaux.`,
      ),
  },
  {
    match:
      /^Day (\d+) (Morning|Afternoon): end time must be after start time on the same day\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}. gün ${translate(l, m[2])}: bitiş saati aynı gün içinde başlangıçtan sonra olmalıdır.`,
        `Jour ${m[1]}, ${translate(l, m[2])} : la fin doit être après le début, le même jour.`,
      ),
  },
  {
    match:
      /^Day (\d+) (Morning|Afternoon): staffing must be a whole number from 0–30\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}. gün ${translate(l, m[2])}: personel sayısı 0–30 arasında bir tamsayı olmalıdır.`,
        `Jour ${m[1]}, ${translate(l, m[2])} : l’effectif doit être un entier entre 0 et 30.`,
      ),
  },
  {
    match:
      /^Day (\d+) (Morning|Afternoon): needs (\d+), but only (\d+) eligible employees are available\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}. gün ${translate(l, m[2])}: ${m[3]} çalışan gerekiyor, ancak yalnızca ${m[4]} uygun çalışan var.`,
        `Jour ${m[1]}, ${translate(l, m[2])} : ${m[3]} employé(s) requis, mais seulement ${m[4]} disponible(s) et admissible(s).`,
      ),
  },
  {
    match: /^Day (\d+) (Morning|Afternoon): (\d+) unfilled position\(s\)\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}. gün ${translate(l, m[2])}: ${m[3]} açık pozisyon var.`,
        `Jour ${m[1]}, ${translate(l, m[2])} : ${m[3]} poste(s) non pourvu(s).`,
      ),
  },
  {
    match:
      /^Weekly demand is ([\d.]+) hours; employee limits provide only ([\d.]+) hours\.$/,
    render: (m, l) =>
      pick(
        l,
        `Haftalık ihtiyaç ${formatNumber(l, +m[1])} saat; çalışan sınırları yalnızca ${formatNumber(l, +m[2])} saat sağlıyor.`,
        `Le besoin hebdomadaire est de ${formatNumber(l, +m[1])} heures ; les limites des employés ne permettent que ${formatNumber(l, +m[2])} heures.`,
      ),
  },
  {
    match: /^(.+) is unavailable for day (\d+) (Morning|Afternoon)\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}, ${m[2]}. gün ${translate(l, m[3])} vardiyası için uygun değil.`,
        `${m[1]} est indisponible le jour ${m[2]}, ${translate(l, m[3])}.`,
      ),
  },
  {
    match: /^(.+) has overlapping shifts on day (\d+)\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]} için ${m[2]}. gün çakışan vardiyalar var.`,
        `${m[1]} a des créneaux qui se chevauchent le jour ${m[2]}.`,
      ),
  },
  {
    match: /^(.+): ([\d.]+)h exceeds the ([\d.]+)h weekly limit\.$/,
    render: (m, l) =>
      pick(
        l,
        `${m[1]}: ${formatNumber(l, +m[2])} saat, haftalık ${formatNumber(l, +m[3])} saat sınırını aşıyor.`,
        `${m[1]} : ${formatNumber(l, +m[2])} h dépasse la limite hebdomadaire de ${formatNumber(l, +m[3])} h.`,
      ),
  },
  {
    match: /^(.+) required staff$/,
    render: (m, l) =>
      pick(l, `${m[1]} gerekli personel`, `${m[1]} : personnel requis`),
  },
];

export function translate(language: Language, value: string): string {
  if (language === "en" || !value.trim()) return value;
  if (value.includes("\n"))
    return value
      .split("\n")
      .map((line) => translate(language, line))
      .join("\n");
  const trimmed = value.trim();
  if (language === "es") {
    for (const pattern of spanishPatterns) {
      const match = trimmed.match(pattern.match);
      if (match) return value.replace(trimmed, pattern.render(match));
    }
  }
  let output = dictionary[trimmed]?.[language === "tr" ? 0 : language === "fr" ? 1 : 2];
  if (output === undefined)
    for (const pattern of patterns) {
      const match = trimmed.match(pattern.match);
      if (match) {
        output = pattern.render(match, language);
        break;
      }
    }
  if (output === undefined || !output) return value;
  return (
    value.slice(0, value.indexOf(trimmed)) +
    output +
    value.slice(value.indexOf(trimmed) + trimmed.length)
  );
}
export function formatNumber(language: Language, n: number) {
  return new Intl.NumberFormat(locales[language], {
    maximumFractionDigits: 2,
  }).format(n);
}
export function formatMoney(language: Language, n: number) {
  return new Intl.NumberFormat(locales[language], {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}
export function formatDay(
  language: Language,
  date: string,
  part: "full" | "weekday" | "date" = "full",
) {
  if (!date) return "";
  const options: Intl.DateTimeFormatOptions =
    part === "weekday"
      ? { weekday: "short" }
      : part === "date"
        ? { month: "short", day: "numeric" }
        : { weekday: "short", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(locales[language], {
    ...options,
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
export function formatRunTime(language: Language, value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return translate(language, value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locales[language], {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(date);
}
export function weekLetters(language: Language) {
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locales[language], {
      weekday: "narrow",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 10, 16 + i))),
  );
}
