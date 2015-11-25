export default function demo (options?: {
        option1?: string,
        option2?: boolean,
        option3?: number
    } = {
      option3: undefined
    })
{
    return options;
}