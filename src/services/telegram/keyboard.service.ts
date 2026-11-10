import { InlineKeyboard } from 'grammy';
import { RECOMMENDED_GEMINI_MODELS } from '../../types/session.js';
import type { ProjectInfo } from '../workspace.service.js';

export class TelegramKeyboardService {
  static mainDashboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('📁 فایل‌های پروژه', 'cb:files')
      .text('📦 دریافت خروجی ZIP', 'cb:zip')
      .row()
      .text('🗂 تغییر پروژه', 'cb:projects')
      .text('🌿 وضعیت Git', 'cb:git_status')
      .row()
      .text('🤖 تغییر مدل Gemini', 'cb:models')
      .text('🧹 پاکسازی حافظه چت', 'cb:reset');
  }

  static afterAgentReply(): InlineKeyboard {
    return new InlineKeyboard()
      .text('📁 فایل‌ها', 'cb:files')
      .text('📦 دانلود ZIP پروژه', 'cb:zip')
      .text('🌿 Git Diff/Status', 'cb:git_status');
  }

  static cancelExecution(): InlineKeyboard {
    return new InlineKeyboard().text('⏹ توقف اجرای ایجنت', 'cb:cancel');
  }

  static modelSelector(currentModel: string): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const m of RECOMMENDED_GEMINI_MODELS) {
      const prefix = m.id === currentModel ? '✅ ' : '';
      kb.text(`${prefix}${m.label}`, `cb:set_model:${m.id}`).row();
    }
    return kb;
  }

  static projectSwitcher(projects: ProjectInfo[], activeProject: string): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const proj of projects.slice(0, 12)) {
      const mark = proj.name === activeProject ? '✅ ' : '📂 ';
      kb.text(`${mark}${proj.name} (${proj.fileCount} فایل)`, `cb:switch_proj:${proj.name}`).row();
    }
    return kb;
  }
}
