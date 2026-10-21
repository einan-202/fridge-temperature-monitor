const ALL_BRANCHES = "";

interface BranchFilterProps {
  branches: string[];
  value: string;
  onChange: (branch: string) => void;
}

export function BranchFilter({ branches, value, onChange }: BranchFilterProps) {
  const options =
    value && !branches.includes(value)
      ? [...branches, value].sort((a, b) => a.localeCompare(b))
      : branches;

  return (
    <label className="branch-filter">
      <span className="visually-hidden">Branch</span>
      <select
        className="branch-filter__select"
        aria-label="Branch"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ALL_BRANCHES}>All branches</option>
        {options.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
    </label>
  );
}
