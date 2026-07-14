"use client";

import { useEffect, useState } from "react";

// Флаг живёт на уровне модуля: он сбрасывается только при полной загрузке
// страницы (модуль переоценивается заново). При client-side навигации Next.js
// модуль остаётся в памяти, поэтому интро-каскад играет строго один раз за
// полную загрузку — не при переходах из меню и не при ре-рендерах.
let introPlayed = false;

export function useIntroOnce(): boolean {
  // Значение фиксируется на первом рендере компонента; смена периода и
  // автообновление данных (ре-рендеры) его не меняют.
  const [play] = useState(() => !introPlayed);
  useEffect(() => {
    introPlayed = true;
  }, []);
  return play;
}
