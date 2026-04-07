/**
 * Translate remaining Russian comments to English across the codebase.
 * Targets: resize/, host/ — technical comments about scaling algorithms.
 */
import * as fs from 'fs';
import * as path from 'path';

const TRANSLATIONS: [RegExp, string][] = [
  // Common words/phrases
  [/Опасность\b/g, 'Warning'],
  [/ВАЖНО\b/g, 'IMPORTANT'],
  [/Важно\b/g, 'Important'],
  [/Масштабирует\b/g, 'Scales'],
  [/масштабирует\b/g, 'scales'],
  [/Центрирование\b/g, 'Centering'],
  [/центрирование\b/g, 'centering'],
  [/Классификация\b/g, 'Classification'],
  [/классификация\b/g, 'classification'],
  [/Проверяет\b/g, 'Checks'],
  [/проверяет\b/g, 'checks'],
  [/Используется\b/g, 'Used'],
  [/используется\b/g, 'used'],
  [/Строит\b/g, 'Builds'],
  [/строит\b/g, 'builds'],
  [/Запускает\b/g, 'Runs'],
  [/запускает\b/g, 'runs'],
  [/Поднимаем\b/g, 'Increase'],
  [/Прямоугольник\b/g, 'Rectangle'],
  [/прямоугольник\b/g, 'rectangle'],
  [/Логотипные\b/g, 'Logo-like'],
  [/Эвристика\b/g, 'Heuristic'],
  [/эвристика\b/g, 'heuristic'],
  [/Универсальный\b/g, 'Universal'],
  [/универсальный\b/g, 'universal'],
  [/Стабильный\b/g, 'Stable'],
  [/стабильный\b/g, 'stable'],
  [/Минимальные\b/g, 'Minimum'],
  [/минимальные\b/g, 'minimum'],
  [/Возрастной\b/g, 'Age'],
  [/возрастной\b/g, 'age'],
  [/Пустые\b/g, 'Empty'],
  [/пустые\b/g, 'empty'],
  [/Бонусы за типы\b/g, 'Bonuses by type'],
  [/Не восстанавливаем/g, 'Do not restore'],

  // Nouns
  [/фрейма\b/g, 'frame'],
  [/фрейм\b/g, 'frame'],
  [/кадр\b/g, 'frame'],
  [/кадра\b/g, 'frame'],
  [/ноды\b/g, 'node'],
  [/ноду\b/g, 'node'],
  [/нода\b/g, 'node'],
  [/нод\b/g, 'nodes'],
  [/слоёв\b/g, 'layers'],
  [/слот\b/g, 'slot'],
  [/слотов\b/g, 'slots'],
  [/слоты\b/g, 'slots'],
  [/размера\b/g, 'size'],
  [/размеров\b/g, 'sizes'],
  [/движок\b/g, 'engine'],
  [/Движок\b/g, 'Engine'],
  [/координатах\b/g, 'coordinates'],
  [/координаты\b/g, 'coordinates'],
  [/компенсация\b/g, 'compensation'],
  [/оригинал\b/g, 'original'],
  [/клон\b/g, 'clone'],
  [/баннера\b/g, 'banner'],
  [/баннер\b/g, 'banner'],
  [/кнопки\b/g, 'button'],
  [/кнопка\b/g, 'button'],
  [/контент\b/g, 'content'],
  [/контента\b/g, 'content'],
  [/скейлинг\b/g, 'scaling'],
  [/Скейлинг\b/g, 'Scaling'],
  [/высоту\b/g, 'height'],
  [/ширине\b/g, 'width'],
  [/ширину\b/g, 'width'],
  [/типов\b/g, 'types'],
  [/текст\b/g, 'text'],
  [/текстовые\b/g, 'text'],
  [/позиции\b/g, 'positions'],
  [/позиция\b/g, 'position'],
  [/порядок\b/g, 'order'],
  [/элементов\b/g, 'elements'],
  [/элемент\b/g, 'element'],
  [/иконка\b/g, 'icon'],
  [/подпись\b/g, 'label'],
  [/глубина\b/g, 'depth'],
  [/оболочки\b/g, 'shells'],
  [/пиксели\b/g, 'pixels'],
  [/маппинг\b/g, 'mapping'],
  [/пары\b/g, 'pair'],
  [/ключ\b/g, 'key'],
  [/путь\b/g, 'path'],
  [/индекс\b/g, 'index'],
  [/тип\b/g, 'type'],
  [/число\b/g, 'number'],
  [/доля\b/g, 'fraction'],
  [/метрики\b/g, 'metrics'],
  [/лейбл\b/g, 'label'],
  [/визуальный\b/g, 'visual'],
  [/визуальная\b/g, 'visual'],
  [/семантический\b/g, 'semantic'],
  [/классификатор\b/g, 'classifier'],
  [/гайд\b/g, 'guide'],
  [/гайда\b/g, 'guide'],

  // Verbs/actions
  [/после\b/g, 'after'],
  [/перед\b/g, 'before'],
  [/Если\b/g, 'If'],
  [/если\b/g, 'if'],
  [/чтобы\b/g, 'to'],
  [/может\b/g, 'may'],
  [/только\b/g, 'only'],
  [/типично\b/g, 'typically'],
  [/часто\b/g, 'often'],
  [/внутри\b/g, 'inside'],
  [/Нужен\b/g, 'Needed'],
  [/нужен\b/g, 'needed'],
  [/когда\b/g, 'when'],
  [/Без этого\b/g, 'Without this'],
  [/Как\b(?=\s)/g, 'Like'],
  [/как\b(?=\s)/g, 'like'],
  [/берём\b/g, 'take'],
  [/вписаться\b/g, 'fit'],
  [/сопоставление\b/g, 'matching'],
  [/передан\b/g, 'provided'],
  [/равномерный\b/g, 'uniform'],
  [/дополнительный\b/g, 'additional'],
  [/доверять\b/g, 'trust'],
  [/вызван\b/g, 'called'],
  [/расходится\b/g, 'diverges'],
  [/совпадает\b/g, 'matches'],
  [/сначала\b/g, 'first'],
  [/стабильное\b/g, 'stable'],
  [/удаление\b/g, 'removal'],
  [/пересчитать\b/g, 'recalculate'],
  [/включение\b/g, 'enabling'],
  [/заставляет\b/g, 'forces'],
  [/перезаписать\b/g, 'overwrite'],
  [/расстановки\b/g, 'placement'],
  [/разброс\b/g, 'spread'],
  [/не используем\b/g, 'not used'],
  [/имена\b/g, 'names'],
  [/при вызове\b/g, 'when calling'],
  [/из чего\b/g, 'from what'],
  [/ресайзим\b/g, 'resize from'],
  [/ресайза\b/g, 'resize'],
  [/Те же\b/g, 'Same'],
  [/абсолютным\b/g, 'absolute'],
  [/снимает\b/g, 'collects'],
  [/иначе\b/g, 'otherwise'],

  // Phrases
  [/Тип слота в гайде/g, 'Slot type in guide'],
  [/от корня/g, 'from root'],
  [/среди детей/g, 'among children'],
  [/универсально/g, 'universally'],
  [/Слишком низкий порог давал/g, 'Too low threshold produced'],
  [/микроскопический/g, 'microscopic'],
  [/без принудительной типографики/g, 'without forced typography'],
  [/типографика всех/g, 'typography of all'],
  [/сдвиг/g, 'shift'],
  [/всего контента/g, 'all content'],
  [/группа и т\.д\./g, 'group etc.'],
  [/ставим constraints MIN на поддерево/g, 'set constraints MIN on subtree'],
  [/resize корня/g, 'root resize'],
  [/точкой в координатах/g, 'point in coordinates of'],
  [/глифы/g, 'glyphs'],
  [/layout width\/height/g, 'layout width/height'],
  [/min стороны/g, 'min side of'],
  [/учётом его типа и лимитов/g, 'considering its type and limits'],
  [/специфичных/g, 'specific'],
  [/Bbox ноды в координатах/g, 'Node bbox in coordinates of'],
  [/Анализируем фон/g, 'Analyze background of'],
  [/Анализирует фон/g, 'Analyzes background of'],
  [/Рекурсивно обходит children/g, 'Recursively traverses children of'],
  [/Создаёт объект трансформации для/g, 'Creates transform object for'],
  [/Главный API:/g, 'Main API:'],
  [/Центр ноды совпадает/g, 'Node center matches'],
  [/у прямых детей .* не должно быть двух .* с одним именем/g, 'direct children should not have duplicate names'],
];

const CYRILLIC = /[\u0400-\u04FF]/;

function translateFile(filepath: string): number {
  const content = fs.readFileSync(filepath, 'utf8');
  if (!CYRILLIC.test(content)) return 0;

  let result = content;
  let count = 0;

  for (const [pattern, replacement] of TRANSLATIONS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) count++;
  }

  if (result !== content) {
    fs.writeFileSync(filepath, result, 'utf8');
  }

  // Count remaining Cyrillic lines
  const remaining = result.split('\n').filter(line => CYRILLIC.test(line)).length;
  return remaining;
}

function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) files.push(...walkDir(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full);
  }
  return files;
}

const root = path.resolve('packages/core/src');
const files = walkDir(root);
let totalRemaining = 0;
let filesFixed = 0;

for (const f of files) {
  const remaining = translateFile(f);
  if (remaining > 0) {
    const rel = path.relative(root, f);
    console.log(`  ${rel}: ${remaining} lines remaining`);
    totalRemaining += remaining;
    filesFixed++;
  }
}

console.log(`\n${totalRemaining} Cyrillic lines remaining across ${filesFixed} files`);
