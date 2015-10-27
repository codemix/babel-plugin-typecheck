function zero(): number
{
	if (true)
		return [].length;
}

export default function test(): number
{
	return zero();
}