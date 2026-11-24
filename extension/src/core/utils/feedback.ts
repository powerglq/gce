// 安全的全局反馈工具
export interface ToastOptions {
  duration?: number;
  type?: 'info' | 'success' | 'warning' | 'error';
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
}

let toastCount = 0;

export function toast(message: string, options: ToastOptions = {}): void {
  if (!message?.trim()) return;
  
  const { duration = 3000, type = 'info' } = options;
  const id = `gce-toast-${++toastCount}`;
  
  // 创建toast元素
  const toast = document.createElement('div');
  toast.id = id;
  toast.className = `gce-toast gce-toast-${type}`;
  toast.textContent = message;
  
  // 应用样式
  // 层级取自 CSS 变量（--z-toast = 400000），必须高于所有遮罩，
  // 否则在设置抽屉/笔记面板打开时的提示会被遮住。
  Object.assign(toast.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warn)' : type === 'success' ? 'var(--success)' : 'var(--toast-bg)',
    color: 'var(--on-accent)',
    padding: '10px 14px',
    borderRadius: 'var(--r-lg)',
    fontSize: 'var(--fs-base)',
    boxShadow: 'var(--shadow)',
    zIndex: 'var(--z-toast)',
    pointerEvents: 'auto',
    maxWidth: '80vw',
    wordBreak: 'break-word',
  });
  
  document.body.appendChild(toast);
  
  // 自动移除
  setTimeout(() => {
    try {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    } catch {}
  }, duration);
}

export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options;
  const {
    title = '确认',
    message,
    confirmText = '确定',
    cancelText = '取消',
    variant = 'default',
  } = opts;
  
  if (!message?.trim()) {
    return Promise.resolve(false);
  }
  
  return new Promise((resolve) => {
    const id = `gce-confirm-${Date.now()}`;
    
    // 创建遮罩
    const mask = document.createElement('div');
    mask.id = `${id}-mask`;
    Object.assign(mask.style, {
      position: 'fixed',
      inset: '0',
      background: 'var(--scrim-strong)',
      backdropFilter: 'blur(10px)',
      zIndex: 'var(--z-mask)',
    });
    
    // 创建对话框
    const modal = document.createElement('div');
    modal.id = id;
    Object.assign(modal.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%) scale(.98)',
      minWidth: '320px',
      maxWidth: '80vw',
      background: 'var(--overlay)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-xl)',
      padding: '16px',
      boxShadow: 'var(--shadow)',
      zIndex: 'var(--z-dialog)',
      opacity: '0',
      transition: 'transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)',
    });
    
    // 内容
    const content = document.createElement('div');
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.textContent = title;
      Object.assign(titleEl.style, {
        fontWeight: '800',
        marginBottom: '8px',
        letterSpacing: '.2px',
      });
      content.appendChild(titleEl);
    }
    
    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    Object.assign(messageEl.style, {
      lineHeight: '1.6',
      marginBottom: '14px',
      opacity: '0.92',
    });
    content.appendChild(messageEl);
    
    // 按钮
    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '10px',
    });
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelText;
    Object.assign(cancelBtn.style, {
      padding: '8px 12px',
      borderRadius: 'var(--r-lg)',
      cursor: 'pointer',
      border: '1px solid var(--border)',
      background: 'var(--overlay-hover)',
      color: 'var(--text)',
      outline: 'none',
    });
    
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmText;
    const isDanger = variant === 'danger' || /删除|移除|清空|重置/.test(confirmText);
    Object.assign(confirmBtn.style, {
      padding: '8px 12px',
      borderRadius: '10px',
      cursor: 'pointer',
      border: 'none',
      background: isDanger ? 'var(--danger)' : 'var(--primary)',
      color: 'var(--on-accent)',
      outline: 'none',
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    content.appendChild(actions);
    modal.appendChild(content);
    
    // 清理函数
    const cleanup = () => {
      try {
        document.removeEventListener('keydown', handleKeydown);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        if (modal.parentNode) modal.parentNode.removeChild(modal);
      } catch {}
    };
    
    // 事件监听
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    
    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };
    
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    mask.addEventListener('click', handleCancel);
    
    // ESC / Enter 支持
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
        return;
      }
      if (e.key === 'Enter') {
        handleConfirm();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    
    // 添加到DOM
    document.body.appendChild(mask);
    document.body.appendChild(modal);

    // 入场动画
    requestAnimationFrame(() => {
      try {
        modal.style.opacity = '1';
        modal.style.transform = 'translate(-50%, -50%) scale(1)';
      } catch {}
    });
    
    // 聚焦确认按钮
    confirmBtn.focus();
  });
}