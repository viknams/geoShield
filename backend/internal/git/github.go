package git

import (
	"context"
	"fmt"

	"github.com/google/go-github/v60/github"
	"golang.org/x/oauth2"
)

type GitHubService struct {
	client *github.Client
	owner  string
	repo   string
}

func NewGitHubService(token, owner, repo string) *GitHubService {
	ts := oauth2.StaticTokenSource(
		&oauth2.Token{AccessToken: token},
	)
	tc := oauth2.NewClient(context.Background(), ts)
	client := github.NewClient(tc)

	return &GitHubService{
		client: client,
		owner:  owner,
		repo:   repo,
	}
}

type CommitFile struct {
	Path    string
	Content string
}

func (s *GitHubService) CreatePullRequest(ctx context.Context, branchName, baseBranch, title, body string, files []CommitFile) (*github.PullRequest, error) {
	// 1. Get the SHA of the base branch
	baseRef, _, err := s.client.Git.GetRef(ctx, s.owner, s.repo, "refs/heads/"+baseBranch)
	if err != nil {
		return nil, fmt.Errorf("failed to get base branch ref: %w", err)
	}

	// 2. Create a new branch
	newRef := &github.Reference{
		Ref:    github.String("refs/heads/" + branchName),
		Object: &github.GitObject{SHA: baseRef.Object.SHA},
	}
	_, _, err = s.client.Git.CreateRef(ctx, s.owner, s.repo, newRef)
	if err != nil {
		return nil, fmt.Errorf("failed to create new branch: %w", err)
	}

	// 3. Create a tree with the multiple files
	entries := []*github.TreeEntry{}
	for _, file := range files {
		entries = append(entries, &github.TreeEntry{
			Path:    github.String(file.Path),
			Type:    github.String("blob"),
			Content: github.String(file.Content),
			Mode:    github.String("100644"),
		})
	}

	tree, _, err := s.client.Git.CreateTree(ctx, s.owner, s.repo, *baseRef.Object.SHA, entries)
	if err != nil {
		return nil, fmt.Errorf("failed to create git tree: %w", err)
	}

	// 4. Create a commit
	commit := &github.Commit{
		Message: github.String("Automated commit: provisioning infrastructure"),
		Tree:    tree,
		Parents: []*github.Commit{{SHA: baseRef.Object.SHA}},
	}
	newCommit, _, err := s.client.Git.CreateCommit(ctx, s.owner, s.repo, commit, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create commit: %w", err)
	}

	// 5. Update the reference (branch) to the new commit
	targetRef := &github.Reference{
		Ref:    github.String("refs/heads/" + branchName),
		Object: &github.GitObject{SHA: newCommit.SHA},
	}
	_, _, err = s.client.Git.UpdateRef(ctx, s.owner, s.repo, targetRef, false)
	if err != nil {
		return nil, fmt.Errorf("failed to update ref: %w", err)
	}

	// 6. Create the pull request
	newPR := &github.NewPullRequest{
		Title:               github.String(title),
		Head:                github.String(branchName),
		Base:                github.String(baseBranch),
		Body:                github.String(body),
		MaintainerCanModify: github.Bool(true),
	}
	pr, _, err := s.client.PullRequests.Create(ctx, s.owner, s.repo, newPR)
	if err != nil {
		return nil, fmt.Errorf("failed to create pull request: %w", err)
	}

	return pr, nil
}
