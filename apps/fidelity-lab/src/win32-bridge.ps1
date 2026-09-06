param()

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FidelityLabWindow {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extraData);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint source, uint target, bool attach);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern int ShowCursor(bool show);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    static IntPtr current = IntPtr.Zero;
    static uint wantedPid;
    static string wantedTitle = "";
    static bool inputSession;
    static bool buttonDown;
    static int inputPositionX;
    static int inputPositionY;
    static POINT savedCursor;
    static bool cursorHidden;
    static IntPtr savedForeground = IntPtr.Zero;

    static IntPtr MousePosition(int x, int y) {
        return new IntPtr((y << 16) | (x & 0xffff));
    }

    public static long Locate(uint pid, string title) {
        SetProcessDPIAware();
        wantedPid = pid;
        wantedTitle = title ?? "";
        current = IntPtr.Zero;
        EnumWindows((handle, _) => {
            if (!IsWindowVisible(handle)) return true;
            uint owner;
            GetWindowThreadProcessId(handle, out owner);
            int length = GetWindowTextLength(handle);
            var text = new StringBuilder(length + 1);
            GetWindowText(handle, text, text.Capacity);
            bool pidMatch = wantedPid == 0 || owner == wantedPid;
            bool titleMatch = wantedTitle.Length == 0 || text.ToString().IndexOf(wantedTitle, StringComparison.OrdinalIgnoreCase) >= 0;
            if (pidMatch && titleMatch) { current = handle; return false; }
            return true;
        }, IntPtr.Zero);
        if (current != IntPtr.Zero) ShowWindowAsync(current, 9);
        return current.ToInt64();
    }

    static IntPtr Require() {
        if (current == IntPtr.Zero) throw new InvalidOperationException("TouchHLE window is not attached");
        return current;
    }

    static void Focus(IntPtr handle) {
        uint ignored;
        uint currentThread = GetCurrentThreadId();
        uint targetThread = GetWindowThreadProcessId(handle, out ignored);
        IntPtr foreground = GetForegroundWindow();
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
        bool attachedTarget = targetThread != 0 && targetThread != currentThread && AttachThreadInput(currentThread, targetThread, true);
        bool attachedForeground = foregroundThread != 0 && foregroundThread != currentThread && foregroundThread != targetThread &&
            AttachThreadInput(currentThread, foregroundThread, true);
        try {
            ShowWindowAsync(handle, 9);
            BringWindowToTop(handle);
            SetForegroundWindow(handle);
            SetFocus(handle);
        } finally {
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
        }
    }

    public static int[] Bounds() {
        IntPtr handle = Require();
        RECT rect;
        if (!GetClientRect(handle, out rect)) throw new InvalidOperationException("GetClientRect failed");
        POINT point = new POINT { X = 0, Y = 0 };
        if (!ClientToScreen(handle, ref point)) throw new InvalidOperationException("ClientToScreen failed");
        return new [] { point.X, point.Y, rect.Right - rect.Left, rect.Bottom - rect.Top };
    }

    public static void Capture(string path) {
        int[] bounds = Bounds();
        if (bounds[2] <= 0 || bounds[3] <= 0) throw new InvalidOperationException("TouchHLE client area is empty");
        using (var bitmap = new Bitmap(bounds[2], bounds[3], PixelFormat.Format24bppRgb))
        using (var graphics = Graphics.FromImage(bitmap)) {
            graphics.CopyFromScreen(bounds[0], bounds[1], 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
            bitmap.Save(path, ImageFormat.Png);
        }
    }

    public static void FocusWindow() {
        Focus(Require());
    }

    public static void BeginInput() {
        if (inputSession) throw new InvalidOperationException("A native input session is already active");
        if (!GetCursorPos(out savedCursor)) throw new InvalidOperationException("GetCursorPos failed");
        savedForeground = GetForegroundWindow();
        inputSession = true;
        buttonDown = false;
        ShowCursor(false);
        cursorHidden = true;
        Focus(Require());
    }

    static void WaitUntil(long targetEpochMs) {
        if (targetEpochMs <= 0) return;
        while (true) {
            long remaining = targetEpochMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (remaining <= 0) return;
            if (remaining > 3) Thread.Sleep((int)Math.Min(remaining - 2, 20));
            else Thread.SpinWait(64);
        }
    }

    public static int EndInput() {
        if (!inputSession) return 3;
        try {
            if (buttonDown) {
                SendMessage(Require(), 0x0202, IntPtr.Zero, MousePosition(inputPositionX, inputPositionY));
                buttonDown = false;
            }
            if (savedForeground != IntPtr.Zero) Focus(savedForeground);
            bool focusRestored = savedForeground == IntPtr.Zero || GetForegroundWindow() == savedForeground;
            bool cursorRestored = SetCursorPos(savedCursor.X, savedCursor.Y);
            return (cursorRestored ? 1 : 0) | (focusRestored ? 2 : 0);
        } finally {
            if (cursorHidden) ShowCursor(true);
            cursorHidden = false;
            inputSession = false;
            savedForeground = IntPtr.Zero;
        }
    }

    public static long Input(string phase, double normalizedX, double normalizedY, bool focusWindow, long targetEpochMs) {
        int[] bounds = Bounds();
        int x = Math.Max(0, Math.Min(bounds[2] - 1, (int)Math.Round(normalizedX * (bounds[2] - 1))));
        int y = Math.Max(0, Math.Min(bounds[3] - 1, (int)Math.Round(normalizedY * (bounds[3] - 1))));
        IntPtr handle = Require();
        if (focusWindow) Focus(handle);
        int screenX = bounds[0] + x;
        int screenY = bounds[1] + y;
        bool needsPosition = inputPositionX != x || inputPositionY != y;
        bool positionChanged = needsPosition;
        if (phase == "down" && needsPosition) {
            if (!SetCursorPos(screenX, screenY)) throw new InvalidOperationException("SetCursorPos failed");
            inputPositionX = x;
            inputPositionY = y;
            needsPosition = false;
        }
        WaitUntil(targetEpochMs);
        if (needsPosition) {
            if (!SetCursorPos(screenX, screenY)) throw new InvalidOperationException("SetCursorPos failed");
            inputPositionX = x;
            inputPositionY = y;
        }
        IntPtr position = MousePosition(x, y);
        switch (phase) {
            case "down":
                SendMessage(handle, 0x0200, IntPtr.Zero, position);
                SendMessage(handle, 0x0201, new IntPtr(1), position);
                buttonDown = true;
                break;
            case "move":
                SendMessage(handle, 0x0200, new IntPtr(1), position);
                break;
            case "up":
                if (positionChanged) SendMessage(handle, 0x0200, new IntPtr(1), position);
                SendMessage(handle, 0x0202, IntPtr.Zero, position);
                buttonDown = false;
                break;
            default: throw new ArgumentException("Unknown input phase " + phase);
        }
        inputPositionX = x;
        inputPositionY = y;
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }
}
'@ -ReferencedAssemblies System.Drawing

function Reply($id, $ok, $payload) {
    $response = [ordered]@{ id = $id; ok = $ok }
    if ($ok) { $response.result = $payload } else { $response.error = [string]$payload }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8))
    [Console]::Out.Flush()
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $command = $line | ConvertFrom-Json
    try {
        switch ($command.command) {
            'locate' {
                $processId = 0
                if ($null -ne $command.pid) { $processId = [uint32]$command.pid }
                $handle = [FidelityLabWindow]::Locate($processId, [string]$command.title)
                if ($handle -eq 0) { throw 'No visible TouchHLE window matched the requested pid/title' }
                Reply $command.id $true @{ handle = $handle; bounds = [FidelityLabWindow]::Bounds() }
            }
            'capture' {
                [FidelityLabWindow]::Capture([string]$command.path)
                Reply $command.id $true @{ bounds = [FidelityLabWindow]::Bounds() }
            }
            'input' {
                $focusWindow = $true
                if ($null -ne $command.focus) { $focusWindow = [bool]$command.focus }
                $targetEpochMs = 0
                if ($null -ne $command.targetEpochMs) { $targetEpochMs = [int64]$command.targetEpochMs }
                $deliveredAt = [FidelityLabWindow]::Input(
                    [string]$command.phase, [double]$command.x, [double]$command.y, $focusWindow, $targetEpochMs)
                Reply $command.id $true @{ deliveredAt = $deliveredAt }
            }
            'focus' { [FidelityLabWindow]::FocusWindow(); Reply $command.id $true $null }
            'begin-input' {
                [FidelityLabWindow]::BeginInput()
                Reply $command.id $true $null
            }
            'end-input' {
                $restored = [FidelityLabWindow]::EndInput()
                Reply $command.id $true @{
                    cursorRestored = [bool]($restored -band 1)
                    focusRestored = [bool]($restored -band 2)
                }
            }
            'bounds' { Reply $command.id $true @{ bounds = [FidelityLabWindow]::Bounds() } }
            'quit' { Reply $command.id $true $null; exit 0 }
            default { throw "Unknown bridge command $($command.command)" }
        }
    } catch {
        Reply $command.id $false $_.Exception.Message
    }
}
