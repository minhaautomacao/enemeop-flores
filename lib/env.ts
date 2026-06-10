export const cleanEnv = (v: string | undefined) => v?.replace(/^﻿/, '').trim() ?? '';
