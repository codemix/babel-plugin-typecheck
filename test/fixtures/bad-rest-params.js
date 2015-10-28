function countArgs(...args: number): number
{
	return args.length;
}

export default function test(): number
{
	return countArgs();
}