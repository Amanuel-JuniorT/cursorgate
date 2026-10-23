# Quick check: how many Cursor windows EnumWindows sees
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class CompanionWin3Test {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public static List<string> ListCursorWindows() {
    var list = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len <= 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      string t = sb.ToString();
      if (t.IndexOf("Cursor", StringComparison.OrdinalIgnoreCase) < 0) return true;
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      list.Add(pid.ToString() + " | " + t);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@
$wins = [CompanionWin3Test]::ListCursorWindows()
Write-Output ("count=" + $wins.Count)
$wins | ForEach-Object { Write-Output $_ }
Write-Output "--- Get-Process MainWindow ---"
Get-Process | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and (
    $_.ProcessName -eq 'Cursor' -or ($_.MainWindowTitle -and $_.MainWindowTitle -like '*Cursor*')
  )
} | ForEach-Object { Write-Output ("pid=$($_.Id) | $($_.MainWindowTitle)") }
