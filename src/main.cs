using System;
using System.Buffers;
using System.Diagnostics;
using System.Globalization;
using System.Numerics;
using System.Runtime.CompilerServices;
using System.Text;

namespace HighPerfStructBenchmark;

// Nonnegative arbitrary-precision integer, base 2^64. Default value is zero.
public readonly struct FastBigIntStruct
{
    private readonly ulong[]? _bits;
    private readonly int _length;

    public FastBigIntStruct(string? s)
    {
        ReadOnlySpan<char> text = s.AsSpan().Trim();
        if (!text.IsEmpty && text[0] == '+') text = text[1..];
        if (text.IsEmpty) { this = default; return; }
        var bits = new ulong[text.Length / 18 + 1];
        int length = 0;
        foreach (char c in text)
        {
            if (c < '0' || c > '9') throw new FormatException("Expected a nonnegative decimal integer.");
            ulong carry = (uint)(c - '0');
            for (int i = 0; i < length; i++)
            {
                ulong high = Math.BigMul(bits[i], 10, out ulong low);
                ulong value = low + carry;
                bits[i] = value;
                carry = high + (value < low ? 1UL : 0UL);
            }
            if (carry != 0) bits[length++] = carry;
        }
        _bits = length == 0 ? null : bits;
        _length = length;
    }

    private FastBigIntStruct(ulong[] bits, int length)
    {
        while (length > 0 && bits[length - 1] == 0) length--;
        _bits = length == 0 ? null : bits;
        _length = length;
    }

    public static FastBigIntStruct operator +(FastBigIntStruct a, FastBigIntStruct b)
    {
        if (a._length == 0) return b;
        if (b._length == 0) return a;
        if (a._length < b._length) (a, b) = (b, a);
        var result = new ulong[a._length + 1];
        ulong carry = 0;
        int i = 0;
        for (; i < b._length; i++)
        {
            ulong left = a._bits![i];
            ulong sum = left + b._bits![i];
            ulong value = sum + carry;
            result[i] = value;
            carry = (sum < left || value < sum) ? 1UL : 0UL;
        }
        for (; i < a._length; i++)
        {
            ulong sum = a._bits![i] + carry;
            result[i] = sum;
            carry = sum < a._bits![i] ? 1UL : 0UL;
        }
        result[i] = carry;
        return new FastBigIntStruct(result, i + (carry == 0 ? 0 : 1));
    }

    public static FastBigIntStruct operator *(FastBigIntStruct a, FastBigIntStruct b)
    {
        if (a._length == 0 || b._length == 0) return default;
        var result = new ulong[a._length + b._length];
        var left = a._bits.AsSpan(0, a._length);
        var right = b._bits.AsSpan(0, b._length);
        if (Math.Min(a._length, b._length) < KaratsubaThreshold)
            Schoolbook(left, right, result);
        else
            Multiply(left, right, result);
        return new FastBigIntStruct(result, result.Length);
    }

    // Small operands use schoolbook multiplication; larger balanced operands
    // use three half-size products. Scratch storage is shared per recursive call.
    private const int KaratsubaThreshold = 24;

    private static void Multiply(ReadOnlySpan<ulong> a, ReadOnlySpan<ulong> b, Span<ulong> result)
    {
        while (!a.IsEmpty && a[^1] == 0) a = a[..^1];
        while (!b.IsEmpty && b[^1] == 0) b = b[..^1];
        result.Clear();
        if (a.IsEmpty || b.IsEmpty) return;
        int split = Math.Max(a.Length, b.Length) / 2;
        if (Math.Min(a.Length, b.Length) < KaratsubaThreshold || Math.Min(a.Length, b.Length) <= split)
        {
            Schoolbook(a, b, result);
            return;
        }

        var aLow = a[..split];
        var aHigh = a[split..];
        var bLow = b[..split];
        var bHigh = b[split..];
        var lowProduct = result[..(split * 2)];
        var highProduct = result[(split * 2)..(a.Length + b.Length)];
        Multiply(aLow, bLow, lowProduct);
        Multiply(aHigh, bHigh, highProduct);

        int aCapacity = Math.Max(aLow.Length, aHigh.Length) + 1;
        int bCapacity = Math.Max(bLow.Length, bHigh.Length) + 1;
        int size = 2 * (aCapacity + bCapacity);
        ulong[]? rented = null;
        Span<ulong> scratch = size <= 256 ? stackalloc ulong[size] : (rented = ArrayPool<ulong>.Shared.Rent(size)).AsSpan(0, size);
        try
        {
            var aSum = scratch[..aCapacity];
            var bSum = scratch.Slice(aCapacity, bCapacity);
            int aLength = AddMagnitude(aLow, aHigh, aSum);
            int bLength = AddMagnitude(bLow, bHigh, bSum);
            var middle = scratch[(aCapacity + bCapacity)..];
            Multiply(aSum[..aLength], bSum[..bLength], middle);
            SubtractMagnitude(middle, lowProduct);
            SubtractMagnitude(middle, highProduct);
            int middleLength = middle.Length;
            while (middleLength > 0 && middle[middleLength - 1] == 0) middleLength--;
            AddAt(result[split..], middle[..middleLength]);
        }
        finally
        {
            if (rented != null) ArrayPool<ulong>.Shared.Return(rented);
        }
    }

    private static int AddMagnitude(ReadOnlySpan<ulong> a, ReadOnlySpan<ulong> b, Span<ulong> result)
    {
        int length = Math.Max(a.Length, b.Length);
        ulong carry = 0;
        for (int i = 0; i < length; i++)
        {
            ulong left = i < a.Length ? a[i] : 0;
            ulong right = i < b.Length ? b[i] : 0;
            ulong sum = left + right;
            ulong value = sum + carry;
            carry = sum < left || value < sum ? 1UL : 0UL;
            result[i] = value;
        }
        result[length] = carry;
        return length + (carry == 0 ? 0 : 1);
    }

    // The minuend is at least the subtrahend at both Karatsuba subtraction steps.
    private static void SubtractMagnitude(Span<ulong> result, ReadOnlySpan<ulong> value)
    {
        ulong borrow = 0;
        for (int i = 0; i < result.Length; i++)
        {
            ulong left = result[i];
            ulong right = i < value.Length ? value[i] : 0;
            ulong difference = left - right;
            ulong next = difference - borrow;
            borrow = left < right || difference < borrow ? 1UL : 0UL;
            result[i] = next;
        }
        Debug.Assert(borrow == 0);
    }

    private static void AddAt(Span<ulong> result, ReadOnlySpan<ulong> value)
    {
        ulong carry = 0;
        int i = 0;
        for (; i < value.Length; i++)
        {
            ulong left = result[i];
            ulong sum = left + value[i];
            ulong next = sum + carry;
            carry = sum < left || next < sum ? 1UL : 0UL;
            result[i] = next;
        }
        while (carry != 0)
        {
            ulong next = result[i] + carry;
            carry = next == 0 ? 1UL : 0UL;
            result[i++] = next;
        }
    }

    private static void Schoolbook(ReadOnlySpan<ulong> a, ReadOnlySpan<ulong> b, Span<ulong> result)
    {
        for (int i = 0; i < a.Length; i++)
        {
            ulong carry = 0;
            ulong left = a[i];
            var row = result.Slice(i, b.Length + 1);
            for (int j = 0; j < b.Length; j++)
            {
                ulong high = Math.BigMul(left, b[j], out ulong low);
                ulong sum = low + row[j];
                high += sum < low ? 1UL : 0UL;
                ulong value = sum + carry;
                high += value < sum ? 1UL : 0UL;
                row[j] = value;
                carry = high;
            }
            row[b.Length] = carry;
        }
    }

    public override string ToString()
    {
        if (_length == 0) return "0";
        // Decimal formatting uses 32-bit division; arithmetic uses 64-bit limbs.
        var work = new uint[_length * 2];
        for (int i = 0; i < _length; i++)
        {
            work[2 * i] = (uint)_bits![i];
            work[2 * i + 1] = (uint)(_bits[i] >> 32);
        }
        var chunks = new System.Collections.Generic.List<uint>();
        int length = work.Length;
        while (length > 0)
        {
            ulong remainder = 0;
            for (int i = length - 1; i >= 0; i--)
            {
                ulong value = (remainder << 32) | work[i];
                work[i] = (uint)(value / 1_000_000_000);
                remainder = value % 1_000_000_000;
            }
            chunks.Add((uint)remainder);
            while (length > 0 && work[length - 1] == 0) length--;
        }
        var sb = new StringBuilder();
        sb.Append(chunks[^1].ToString(CultureInfo.InvariantCulture));
        for (int i = chunks.Count - 2; i >= 0; i--)
            sb.Append(chunks[i].ToString("D9", CultureInfo.InvariantCulture));
        return sb.ToString();
    }
}

class Program
{
    private static FastBigIntStruct customSink;
    private static BigInteger netSink;

    static void Main(string[] args)
    {
        Validate();
        if (args.Length == 1 && args[0] == "--validate-only") return;
        int iterations = args.Length == 0 ? 1_000_000 : int.Parse(args[0]);
        if (iterations <= 0) throw new ArgumentOutOfRangeException(nameof(iterations));
        Console.WriteLine($"Runtime: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}");
        Console.WriteLine($"Iterations: {iterations:N0}; median of 7; parsing/formatting excluded");
        foreach (int digits in new[] { 50, 200, 1000 })
        {
            var a = new FastBigIntStruct(new string('9', digits));
            var b = new FastBigIntStruct(string.Concat(System.Linq.Enumerable.Repeat("1234567890", digits / 10)));
            var x = BigInteger.Parse(a.ToString());
            var y = BigInteger.Parse(b.ToString());
            int count = Math.Max(1000, iterations / (digits / 50));
            Console.WriteLine($"\n{digits} decimal digits ({count:N0} operations/sample)");
            Measure("Fast +", count, n => CustomLoop(a, b, n, false));
            Measure(".NET +", count, n => NetLoop(x, y, n, false));
            Measure("Fast *", count, n => CustomLoop(a, b, n, true));
            Measure(".NET *", count, n => NetLoop(x, y, n, true));
        }
        GC.KeepAlive(customSink);
        GC.KeepAlive(netSink);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void CustomLoop(FastBigIntStruct a, FastBigIntStruct b, int n, bool multiply)
    {
        if (multiply) for (int i = 0; i < n; i++) customSink = a * b;
        else for (int i = 0; i < n; i++) customSink = a + b;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void NetLoop(BigInteger a, BigInteger b, int n, bool multiply)
    {
        if (multiply) for (int i = 0; i < n; i++) netSink = a * b;
        else for (int i = 0; i < n; i++) netSink = a + b;
    }

    static void Measure(string label, int count, Action<int> run)
    {
        // Warm up tiered JIT before collecting samples.
        var warmup = Stopwatch.StartNew();
        do { run(1000); } while (warmup.ElapsedMilliseconds < 250);
        double[] samples = new double[7];
        long allocated = 0;
        for (int i = 0; i < samples.Length; i++)
        {
            GC.Collect();
            GC.WaitForPendingFinalizers();
            long beforeBytes = GC.GetAllocatedBytesForCurrentThread();
            long start = Stopwatch.GetTimestamp();
            run(count);
            long elapsed = Stopwatch.GetTimestamp() - start;
            allocated += GC.GetAllocatedBytesForCurrentThread() - beforeBytes;
            samples[i] = (double)elapsed / Stopwatch.Frequency * 1e9 / count;
        }
        Array.Sort(samples);
        Console.WriteLine($"{label,-8} {samples[3],10:F2} ns/op {allocated / (7.0 * count),8:F1} B/op");
    }

    static void Validate()
    {
        int checks = 0;
        void Check(string sa, string sb)
        {
            var a = new FastBigIntStruct(sa);
            var b = new FastBigIntStruct(sb);
            var x = BigInteger.Parse(sa, CultureInfo.InvariantCulture);
            var y = BigInteger.Parse(sb, CultureInfo.InvariantCulture);
            if (a.ToString() != x.ToString(CultureInfo.InvariantCulture) ||
                (a + b).ToString() != (x + y).ToString(CultureInfo.InvariantCulture) ||
                (a * b).ToString() != (x * y).ToString(CultureInfo.InvariantCulture))
                throw new Exception($"Mismatch: {sa}, {sb}");
            checks++;
        }
        string[] edges = { "0", "1", "000000", "4294967295", "4294967296", "18446744073709551615", "18446744073709551616", new string('9', 1000) };
        foreach (string a in edges) foreach (string b in edges) Check(a, b);
        var random = new Random(42);
        for (int i = 0; i < 1000; i++)
        {
            var a = new byte[random.Next(1, 257)];
            var b = new byte[random.Next(1, 257)];
            random.NextBytes(a);
            random.NextBytes(b);
            Check(new BigInteger(a, isUnsigned: true).ToString(CultureInfo.InvariantCulture),
                  new BigInteger(b, isUnsigned: true).ToString(CultureInfo.InvariantCulture));
        }
        // Exercise carry chains, split boundaries, unequal lengths, recursive
        // Karatsuba, and the pooled scratch path (beyond the stack buffer).
        foreach (int limbs in new[] { 23, 24, 25, 47, 48, 49, 63, 64, 65, 127, 128, 129, 255, 256, 257 })
        {
            BigInteger full = (BigInteger.One << (64 * limbs)) - 1;
            BigInteger sparse = (BigInteger.One << (64 * (limbs - 1))) + 1;
            Check(full.ToString(CultureInfo.InvariantCulture), full.ToString(CultureInfo.InvariantCulture));
            Check(full.ToString(CultureInfo.InvariantCulture), sparse.ToString(CultureInfo.InvariantCulture));
            Check(full.ToString(CultureInfo.InvariantCulture), "18446744073709551615");
        }
        for (int i = 0; i < 64; i++)
        {
            var a = new byte[random.Next(128, 2049)];
            var b = new byte[random.Next(128, 2049)];
            random.NextBytes(a);
            random.NextBytes(b);
            Check(new BigInteger(a, isUnsigned: true).ToString(CultureInfo.InvariantCulture),
                  new BigInteger(b, isUnsigned: true).ToString(CultureInfo.InvariantCulture));
        }
        if (default(FastBigIntStruct).ToString() != "0" ||
            (default(FastBigIntStruct) + new FastBigIntStruct("1")).ToString() != "1" ||
            (default(FastBigIntStruct) * new FastBigIntStruct("1")).ToString() != "0")
            throw new Exception("Default zero failed.");
        Console.WriteLine($"Correctness: {checks:N0} pairs + default zero passed.");
    }
}
