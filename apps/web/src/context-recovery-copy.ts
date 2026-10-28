export const contextRecoveryEn = {
  recoveryPolicy: "Interruption policy",
  recoveryTitle: "Safe automatic recovery",
  recoveryKicker: "SNAPSHOT-BOUND · FAIL CLOSED",
  recoveryMode: "Recovery mode",
  recoveryModes: {
    manual: "Manual resume only",
    safe_read_only: "Automatic · safe read-only",
    verified_patches: "Automatic · verified patches",
  },
  recoveryAttempts: "Maximum attempts",
  recoveryBackoff: "Base delay (sec)",
  recoverySafeBody:
    "Continues local read-only work after checking retained patch results. Unresolved writes and unknown effects stop recovery.",
  recoveryVerifiedBody:
    "Also resumes exact saved patches proven not to have committed. Current permissions and file preconditions must still allow them. The model then continues with read-only tools.",
  recoveryManualBody:
    "Interrupted Runs wait for an operator. Manual Resume remains available and always warns that prior tool outcomes may be unknown.",
};

export const contextRecoveryZh = {
  recoveryPolicy: "中断策略",
  recoveryTitle: "安全自动恢复",
  recoveryKicker: "快照绑定 · 失败即关闭",
  recoveryMode: "恢复模式",
  recoveryModes: {
    manual: "仅手动恢复",
    safe_read_only: "自动 · 安全只读",
    verified_patches: "自动 · 已核验补丁",
  },
  recoveryAttempts: "最大尝试次数",
  recoveryBackoff: "基础延迟（秒）",
  recoverySafeBody:
    "核对保留的补丁结果后继续本地只读工作。未解决的写入和未知副作用会停止恢复。",
  recoveryVerifiedBody:
    "还会继续执行已确认未提交的原始补丁；当前权限和文件前置条件必须仍然允许。随后模型仅使用只读工具继续。",
  recoveryManualBody:
    "中断的运行会等待操作者处理。始终可以手动恢复，并明确警告先前工具结果可能未知。",
};
