using System;
using System.Text;
using UnityEngine;

public static class UidGenerator
{
    public const long TICK_MULTIPLIER = 10000;

    private static long lastTick = DateTime.MinValue.Ticks;
    private static int counter = 0;

    public static long FromTime()
    {
        DateTime jan1_2023 = new DateTime(2023, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        TimeSpan timeSinceJan1_2023 = DateTime.UtcNow - jan1_2023;
        long currentTick = timeSinceJan1_2023.Ticks;

        if (currentTick == lastTick)
        {
            // Increment counter if we're generating multiple UIDs in the same tick
            counter++;
            if(counter>=TICK_MULTIPLIER-1)
                Debug.LogError("UID counter overflow!");
        }
        else
        {
            // Reset counter if we're generating a UID in a new tick
            counter = 0;
            lastTick = currentTick;
        }
    
        // Combine tick count and counter to generate unique ID
        return (currentTick * TICK_MULTIPLIER) + counter;
    }
    private static readonly char[] Base64Chars = "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$".ToCharArray();
    public static long FromString(string base64String)
    { 
        ulong result = 0;
        int strIndex = base64String.Length-1;
        for(int i = 0 ; i<11 ; ++i, --strIndex)
        {
            int index = 0;
            if(strIndex>=0)
            {
                index = Array.IndexOf(Base64Chars,base64String[strIndex]);
                //Debug.Log("pos["+strIndex+"] = "+base64String[strIndex]);
                //Debug.Assert(index>=0);
				if(index==-1)
				{
					Debug.LogError("Illegal character ["+base64String[strIndex]+"] in "+base64String);
					continue;
				}
				Debug.Assert(index >=0 && index <=63);
            }
            result |= ((ulong)index) << (6*i);
        }
        return (long)result;
    }
	public static string ToString(long numSigned)
	{
		ulong num = (ulong)numSigned;
		char[] raw = new char[11];
		int charIndex = 10; // Start from the end of the array

		while (num > 0 || charIndex == 10) // Ensure at least one iteration
		{
			ulong sixBits = num & 0x3F; // Extract 6 bits
			raw[charIndex--] = Base64Chars[sixBits]; // Find corresponding character and assign
			num >>= 6; // Shift right by 6 bits for the next character
		}

		// Create a new string starting from the first non-zero character
		return new string(raw, charIndex + 1, 11 - (charIndex + 1));
	}
    public static void Test()
    {
        void test(long num)
        {
            string s = UidGenerator.ToString(num);
            long num2 = UidGenerator.FromString(s);
            //Debug.Log(num+" -> "+s+" -> "+num2);
            Debug.Assert( num2 == num, "Failed on "+num);
        }
        void testString(string s)
        {
            long v = UidGenerator.FromString(s);
            string s2 = UidGenerator.ToString(v);
            //Debug.Log(s+" -> "+v+" -> "+s2);
            Debug.Assert( s2==s, "Failed on "+s2+"=="+s);
        }
        test(0);
        test(1000);
        test(1234567890123);
        test(-1);
        test(long.MinValue);
        test(long.MinValue/123);
        test(long.MaxValue);
        test(long.MaxValue/3);
        test(long.MaxValue/7);
        test(long.MaxValue/123);
        test(long.MaxValue/3765);
        testString("KEPT31");        
        testString("S5LAMP2");
		testString("WildMap01");
		testString("DogCart");
    }
}
